// Tests for the Purrfect Match 64 leaderboard Worker. Run with: node --test tests/
//
// The Worker's request handler runs against a real SQLite database through a
// tiny stand-in for Cloudflare D1. It issues board tickets and checks scores
// by replaying games with the engine taken from the game page, just like in
// production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { extractEngine } from '../leaderboard/build-engine.mjs';
import { handle, cleanName, signTicket, ipKey } from '../leaderboard/src/api.js';

const html = readFileSync(new URL('../purrfect-match/index.html', import.meta.url), 'utf8');
const { source, version: VERSION } = extractEngine(html);
vm.runInThisContext(source);
const E = globalThis.PurrEngine;
const schema = readFileSync(new URL('../leaderboard/schema.sql', import.meta.url), 'utf8');

// Just enough of the D1 API for the Worker: prepare/bind/first/all/run/batch.
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const prepare = (sql) => {
    const st = db.prepare(sql);
    let args = [];
    const q = {
      bind(...a) { args = a; return q; },
      async first() { return st.get(...args) ?? null; },
      async all() { return { results: st.all(...args) }; },
      async run() { return { meta: { changes: st.run(...args).changes } }; },
      runSync() { return st.run(...args); },
    };
    return q;
  };
  return {
    prepare,
    async batch(list) {
      db.exec('BEGIN');
      try {
        const out = list.map((q) => q.runSync());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

const SECRET = 'test-secret';

function api(extraEnv) {
  const env = { DB: fakeD1(), SEED_SECRET: SECRET, ...extraEnv };
  let clock = 1_000_000;
  const ctx = { E, VERSION, now: () => clock++ };
  const call = async (method, path, body, raw, headers) => {
    const init = { method, headers: { 'Content-Type': 'application/json', ...headers } };
    if (body !== undefined) init.body = raw ? body : JSON.stringify(body);
    const res = await handle(new Request('https://scores.test' + path, init), env, ctx);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, data: text ? JSON.parse(text) : null };
  };
  return { call };
}

// Play a level with the hint bot until it wins, and keep the moves.
const winCache = new Map();
function wins(level, count) {
  const key = level + ':' + count;
  if (winCache.has(key)) return winCache.get(key);
  const out = [];
  for (let seed = 1; out.length < count && seed < 400; seed++) {
    const s = E.newGame(E.LEVELS[level], seed);
    const moves = [];
    while (E.status(s) === 'playing') {
      const mv = E.findHint(s);
      moves.push(mv.type === 'tap' ? [...mv.a] : [...mv.a, ...mv.b]);
      E.playMove(s, mv);
    }
    if (E.status(s) !== 'won') continue;
    E.bonusRound(s);
    out.push({ level, seed, moves, score: s.score, stars: E.starsFor(E.LEVELS[level], s.score) });
  }
  assert.equal(out.length, count, `found ${count} winning games for level ${level + 1}`);
  winCache.set(key, out);
  return out;
}

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const EXP = 9_000_000_000_000;
const ticket = async (player, level, seed, exp = EXP) => ({ seed, exp, sig: await signTicket(SECRET, player, level, seed, exp) });
const post = async (call, player, name, g, extra) =>
  call('POST', '/v1/scores', { v: VERSION, player, name, level: g.level, moves: g.moves, ...(await ticket(player, g.level, g.seed)), ...extra });

// Another winning line on the same board: go off-script once, then follow hints.
function otherWin(g) {
  for (let turn = 0; turn < g.moves.length; turn++) {
    const s = E.newGame(E.LEVELS[g.level], g.seed);
    const moves = [];
    for (let i = 0; E.status(s) === 'playing'; i++) {
      const hint = E.findHint(s);
      const alt = i === turn ? E.listMoves(s, false).find((m) => JSON.stringify(m) !== JSON.stringify(hint)) : null;
      const mv = alt || hint;
      moves.push(mv.type === 'tap' ? [...mv.a] : [...mv.a, ...mv.b]);
      E.playMove(s, mv);
    }
    if (E.status(s) === 'won' && JSON.stringify(moves) !== JSON.stringify(g.moves)) return { ...g, moves };
  }
  throw new Error('no second winning line found');
}

test('the client and Worker agree on the engine version', () => {
  assert.match(VERSION, /^[0-9a-f]{8}$/);
  assert.ok(html.includes('function engineVersion()'), 'the game computes the same version at runtime');
});

test('health check and CORS preflight', async () => {
  const { call } = api();
  const res = await call('GET', '/');
  assert.equal(res.status, 200);
  assert.equal(res.data.version, VERSION);
  assert.equal(res.data.levels, E.LEVELS.length);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const pre = await call('OPTIONS', '/v1/seeds');
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
});

test('a real winning game is replayed, scored and ranked', async () => {
  const { call } = api();
  const [g] = wins(0, 1);
  const res = await post(call, A, 'cat', g);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.data.score, g.score, 'score comes from the replay');
  assert.equal(res.data.stars, g.stars);
  assert.equal(res.data.improved, true);
  assert.deepEqual(res.data.level.top, [{ rank: 1, name: 'CAT', score: g.score, stars: g.stars, me: true }]);
  assert.deepEqual(res.data.overall, [{ rank: 1, name: 'CAT', total: g.score, levels: 1, stars: g.stars, me: true }]);
  assert.deepEqual(res.data.me, { overall: { rank: 1, total: g.score }, level: { rank: 1, score: g.score }, name: 'CAT' });
  assert.ok(!res.text.includes(A), 'player ids never leave the server');
});

test('only a better score replaces your best', async () => {
  const { call } = api();
  const games = wins(0, 3).slice().sort((x, y) => x.score - y.score);
  const [low, , high] = games;
  assert.ok(high.score > low.score);
  assert.equal((await post(call, A, 'CAT', high)).data.improved, true);
  const worse = await post(call, A, 'CAT', low);
  assert.equal(worse.status, 200);
  assert.equal(worse.data.improved, false);
  assert.equal(worse.data.me.level.score, high.score);
  assert.equal(worse.data.level.top.length, 1);
});

test('boards rank players, and the overall board adds up each level', async () => {
  const { call } = api();
  const l1 = wins(0, 3).slice().sort((x, y) => y.score - x.score);
  const [l5] = wins(4, 1);
  await post(call, A, 'AAA', l1[1]);
  await post(call, A, 'AAA', l5);
  const res = await post(call, B, 'BEE', l1[0]);
  const top = res.data.level.top;
  assert.deepEqual(top.map((r) => r.name), ['BEE', 'AAA']);
  assert.deepEqual(top.map((r) => r.score), [l1[0].score, l1[1].score]);
  const totals = { AAA: l1[1].score + l5.score, BEE: l1[0].score };
  const expected = Object.entries(totals).sort((x, y) => y[1] - x[1]);
  assert.deepEqual(res.data.overall.map((r) => [r.name, r.total]), expected);
  assert.equal(res.data.overall.find((r) => r.name === 'AAA').levels, 2);
  assert.equal(res.data.me.level.rank, 1);
  const viewA = await call('GET', `/v1/boards?level=4&player=${A}`);
  assert.equal(viewA.status, 200);
  assert.deepEqual(viewA.data.level.top, [{ rank: 1, name: 'AAA', score: l5.score, stars: l5.stars, me: true }]);
  assert.equal(viewA.data.me.overall.total, totals.AAA);
  const anon = await call('GET', '/v1/boards');
  assert.equal(anon.data.level, undefined);
  assert.equal(anon.data.me, undefined);
  assert.ok(anon.data.overall.every((r) => !r.me));
});

test('board tickets are signed, per player and per level', async () => {
  const { call } = api();
  const res = await call('GET', `/v1/seeds?player=${A}&levels=0,4,4,19`);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.data.seeds.map((t) => t.level), [0, 4, 19]);
  for (const t of res.data.seeds) {
    assert.ok(Number.isInteger(t.seed) && t.seed >= 1 && t.seed <= 0x7fffffff);
    assert.equal(t.sig, await signTicket(SECRET, A, t.level, t.seed, t.exp));
    assert.equal(await signTicket(SECRET, B, t.level, t.seed, t.exp) === t.sig, false, 'bound to the player');
  }
  assert.equal((await call('GET', '/v1/seeds?player=nope&levels=0')).status, 400);
  assert.equal((await call('GET', `/v1/seeds?player=${A}&levels=20`)).status, 400);
  assert.equal((await call('GET', `/v1/seeds?player=${A}`)).status, 400);
  const off = api({ SEED_SECRET: '' });
  assert.equal((await off.call('GET', `/v1/seeds?player=${A}&levels=0`)).status, 503);
});

test('a game has to be played on a real, unexpired, unused ticket', async () => {
  const { call } = api();
  const [g] = wins(0, 1);
  const base = { v: VERSION, player: A, name: 'CAT', level: g.level, moves: g.moves };
  const good = await ticket(A, g.level, g.seed);
  assert.equal((await call('POST', '/v1/scores', { ...base, seed: g.seed })).status, 400, 'no ticket');
  assert.equal((await call('POST', '/v1/scores', { ...base, ...good, sig: 'f'.repeat(32) })).status, 403, 'forged');
  assert.equal((await call('POST', '/v1/scores', { ...base, ...(await ticket(B, g.level, g.seed)) })).status, 403, "someone else's");
  assert.equal((await call('POST', '/v1/scores', { ...base, ...(await ticket(A, 4, g.seed)), level: g.level })).status, 403, 'another level');
  assert.equal((await call('POST', '/v1/scores', { ...base, ...(await ticket(A, g.level, g.seed, 5)) })).status, 403, 'expired');
  const first = await call('POST', '/v1/scores', { ...base, ...good });
  assert.equal(first.status, 200, first.text);
  const retry = await call('POST', '/v1/scores', { ...base, ...good });
  assert.equal(retry.status, 200, 'a retry of the same post is fine');
  assert.equal(retry.data.improved, false);
  const other = otherWin(g);
  const again = await call('POST', '/v1/scores', { ...base, moves: other.moves, ...good });
  assert.equal(again.status, 409, 'the same board twice is not');
  assert.equal(again.data.error, 'seed_used');
});

test('rate limits key IPv6 by network, not by address', () => {
  assert.equal(ipKey('203.0.113.9', 64), '203.0.113.9');
  assert.equal(ipKey('2001:db8:aa:bb:1:2:3:4', 64), '20010db800aa00bb::/64');
  assert.equal(ipKey('2001:db8:aa:bb::9', 64), '20010db800aa00bb::/64', 'same /64, other address');
  assert.equal(ipKey('2001:DB8:AA:BB:FFFF::1', 64), '20010db800aa00bb::/64');
  assert.equal(ipKey('2001:db8:aa:bb::9', 56), '20010db800aa00::/56');
  assert.equal(ipKey('2001:db8::', 64), '20010db800000000::/64');
  assert.equal(ipKey('::ffff:198.51.100.7', 64), '198.51.100.7');
  assert.equal(ipKey(null, 64), 'unknown');
});

test('board tickets have a daily budget per network', async () => {
  const { call } = api({ TICKET_DAILY: '2' });
  const from = (ip) => call('GET', `/v1/seeds?player=${A}&levels=0`, undefined, false, { 'CF-Connecting-IP': ip });
  assert.equal((await from('2001:db8:1:2::1')).status, 200);
  assert.equal((await from('2001:db8:1:2:ffff::1')).status, 200);
  assert.equal((await from('2001:db8:1:2:abcd::9')).status, 429, 'same network, new address');
  assert.equal((await from('2001:db8:1:3::1')).status, 429, 'same /56');
  assert.equal((await from('2001:db8:9:9::1')).status, 200, 'another network');
});

test('busy players get asked to slow down', async () => {
  const { call } = api({ RL_POSTS: { limit: async () => ({ success: false }) }, RL_SEEDS: { limit: async () => ({ success: false }) } });
  assert.equal((await post(call, A, 'CAT', wins(0, 1)[0])).status, 429);
  assert.equal((await call('GET', `/v1/seeds?player=${A}&levels=0`)).status, 429);
  assert.equal((await call('GET', '/v1/boards')).status, 200, 'reads have their own limit');
});

test('tampered games are rejected', async () => {
  const { call } = api();
  const [g] = wins(0, 1);
  const cases = [
    ['different seed', { seed: g.seed + 1 }, 403],
    ['stopped early', { moves: g.moves.slice(0, -1) }, 422],
    ['kept playing after winning', { moves: [...g.moves, g.moves[0]] }, 422],
    ['off the board', { moves: [[0, 0, 0, 8]] }, 400],
    ['too many moves', { moves: Array(E.LEVELS[0].moves + 1).fill([0, 0, 0, 1]) }, 400],
    ['not a move list', { moves: 'lots' }, 400],
    ['no such level', { level: 20 }, 400],
    ['bad seed', { seed: -1 }, 400],
    ['no ticket at all', { sig: undefined }, 400],
  ];
  for (const [what, extra, status] of cases) {
    const res = await call('POST', '/v1/scores', { v: VERSION, player: A, name: 'CAT', level: g.level, moves: g.moves, ...(await ticket(A, g.level, g.seed)), ...extra });
    assert.equal(res.status, status, what);
    assert.equal(res.data.ok, false, what);
  }
  assert.equal((await call('GET', '/v1/boards')).data.overall.length, 0, 'nothing was saved');
});

test('an out of date game is asked to refresh', async () => {
  const { call } = api();
  const res = await post(call, A, 'CAT', wins(0, 1)[0], { v: 'deadbeef' });
  assert.equal(res.status, 409);
  assert.equal(res.data.error, 'version');
});

test('initials are three letters or digits, and kept kitty-friendly', async () => {
  assert.equal(cleanName('mew'), 'MEW');
  assert.equal(cleanName('K9'), null);
  assert.equal(cleanName('A!C'), null);
  assert.equal(cleanName('ASS'), null);
  assert.equal(cleanName('P0W'), 'P0W');
  const { call } = api();
  const g = wins(0, 1)[0];
  assert.equal((await post(call, A, 'FUK', g)).status, 400);
  assert.equal((await post(call, 'NOT-AN-ID', 'CAT', g)).status, 400);
  await post(call, A, 'CAT', g);
  const renamed = await call('POST', '/v1/name', { player: A, name: 'paw' });
  assert.equal(renamed.status, 200);
  assert.equal((await call('GET', '/v1/boards?level=0')).data.level.top[0].name, 'PAW');
  assert.equal((await call('POST', '/v1/name', { player: A, name: 'KKK' })).status, 400);
});

test('junk requests get polite errors', async () => {
  const { call } = api();
  assert.equal((await call('POST', '/v1/scores', '{nope', true)).status, 400);
  assert.equal((await call('POST', '/v1/scores', 'x'.repeat(9000), true)).status, 400);
  assert.equal((await call('POST', '/v1/scores', [1, 2], false)).status, 400);
  assert.equal((await call('GET', '/v1/boards?level=99')).status, 400);
  assert.equal((await call('GET', '/v1/nope')).status, 404);
});
