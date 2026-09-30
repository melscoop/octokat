// Purrfect Match 64 global leaderboard.
//
// Scores are never taken on trust:
// - The game can't pick its own board. It plays on a seed the Worker issued:
//   a "board ticket" signed with a secret, bound to that player and level,
//   good for one post, and handed out at a limited rate.
// - The game sends the seed and the moves it played, and the score is worked
//   out here by replaying that game with the very same engine. A score counts
//   only if the replay finishes the level.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const TOP = 10;
const MAX_BODY = 8192;
const TICKET_TTL = 7 * 24 * 3600 * 1000;
const MEMO_TTL = 15000;
const DAILY_TICKET_REQUESTS = 200;

// Initials that don't belong on a kitty scoreboard.
export const BLOCKED = new Set([
  'ASS', 'CNT', 'COK', 'CUM', 'DIK', 'DIX', 'FAG', 'FCK', 'FUC', 'FUK', 'JIZ', 'KKK',
  'KYS', 'NAZ', 'NGR', 'NIG', 'PUS', 'SEX', 'SHT', 'TIT', 'VAG', 'WTF', 'XXX',
]);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
const fail = (status, error, message) => json({ ok: false, error, message }, status);

export function cleanName(value) {
  const name = String(value == null ? '' : value).toUpperCase();
  return /^[A-Z0-9]{3}$/.test(name) && !BLOCKED.has(name) ? name : null;
}

export function cleanPlayer(value) {
  return typeof value === 'string' && /^[a-f0-9]{16}$/.test(value) ? value : null;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------ board tickets
let keyCache = null;
async function hmacHex(secret, msg) {
  if (!keyCache || keyCache.secret !== secret) {
    const raw = new TextEncoder().encode(secret);
    keyCache = { secret, key: crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) };
  }
  const mac = await crypto.subtle.sign('HMAC', await keyCache.key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(mac).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const signTicket = (secret, player, level, seed, exp) => hmacHex(secret, `${player}.${level}.${seed}.${exp}`);

function sameSig(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ------------------------------------------------------------------ replays
// Moves are [r, c] taps or [r1, c1, r2, c2] swaps.
function parseMoves(list, max) {
  if (!Array.isArray(list) || list.length < 1 || list.length > max) return null;
  const out = [];
  for (const m of list) {
    if (!Array.isArray(m) || (m.length !== 2 && m.length !== 4)) return null;
    if (!m.every((n) => Number.isInteger(n) && n >= 0 && n < 8)) return null;
    out.push(m.slice());
  }
  return out;
}

export function replay(E, level, seed, moves) {
  const lv = E.LEVELS[level];
  const s = E.newGame(lv, seed);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const mv = m.length === 2 ? { type: 'tap', a: [m[0], m[1]] } : { type: 'swap', a: [m[0], m[1]], b: [m[2], m[3]] };
    if (!E.playMove(s, mv).ok) return { ok: false, why: `Move ${i + 1} doesn't work on that board.` };
  }
  if (E.status(s) !== 'won') return { ok: false, why: "That game didn't finish the level." };
  E.bonusRound(s);
  return { ok: true, score: s.score, stars: E.starsFor(lv, s.score) };
}

async function readJson(request) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Who's asking, for rate limits. One IPv6 connection usually controls a
// whole /64 (and a home often a /56), so IPv6 is keyed by prefix instead of
// the exact address, or it could dodge the limits by hopping addresses.
export function ipKey(ip, bits) {
  ip = String(ip || 'unknown').toLowerCase();
  if (!ip.includes(':')) return ip;
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1);
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail != null ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  const hex = groups.slice(0, 8).map((g) => g.padStart(4, '0')).join('');
  return hex.slice(0, bits / 4) + '::/' + bits;
}
const who = (request, bits) => ipKey(request.headers.get('CF-Connecting-IP'), bits);

// Workers rate limiting bindings (see wrangler.toml), per minute.
async function limited(env, binding, request) {
  const rl = env[binding];
  if (!rl || typeof rl.limit !== 'function') return false;
  const { success } = await rl.limit({ key: who(request, 64) });
  return !success;
}

// A daily cap on board tickets per network, so nobody can farm thousands of
// boards to hunt for a lucky one.
async function overDailyBudget(env, request, now) {
  const day = Math.floor(now() / 86400000);
  const row = await env.DB
    .prepare(
      `INSERT INTO ticket_budget (key, day, count) VALUES (?, ?, 1)
       ON CONFLICT(key, day) DO UPDATE SET count = count + 1 RETURNING count`
    )
    .bind(who(request, 56), day)
    .first();
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM ticket_budget WHERE day < ?').bind(day - 1).run();
  return row.count > (Number(env.TICKET_DAILY) || DAILY_TICKET_REQUESTS);
}
const slowDown = () => fail(429, 'slow_down', 'Too many kitties at once! Try again in a minute.');

// ------------------------------------------------------------------ boards
// The public top-10 lists are shared by everyone, so each Worker instance
// keeps them for a few seconds. Player ids stay in here and never go out.
const memos = new WeakMap();
async function topRows(db, key, sql, args) {
  let memo = memos.get(db);
  if (!memo) memos.set(db, (memo = new Map()));
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL) return hit.rows;
  const rows = (await db.prepare(sql).bind(...args).all()).results;
  memo.set(key, { at: Date.now(), rows });
  return rows;
}
const forget = (db) => memos.delete(db);

const mark = (out, row, player) => (player && row.player === player ? { ...out, me: true } : out);

async function boards(db, level, player) {
  const out = {};
  const overall = await topRows(
    db,
    'overall',
    `SELECT p.name AS name, t.player AS player, t.total AS total, t.levels AS levels, t.stars AS stars
     FROM totals t JOIN players p ON p.player = t.player
     ORDER BY t.total DESC, t.last ASC LIMIT ?`,
    [TOP]
  );
  out.overall = overall.map((r, i) => mark({ rank: i + 1, name: r.name, total: r.total, levels: r.levels, stars: r.stars }, r, player));
  if (level != null) {
    const top = await topRows(
      db,
      'level:' + level,
      `SELECT p.name AS name, b.player AS player, b.score AS score, b.stars AS stars
       FROM best b JOIN players p ON p.player = b.player
       WHERE b.level = ? ORDER BY b.score DESC, b.created_at ASC LIMIT ?`,
      [level, TOP]
    );
    out.level = { level, top: top.map((r, i) => mark({ rank: i + 1, name: r.name, score: r.score, stars: r.stars }, r, player)) };
  }
  if (player) {
    const me = {};
    const o = await db
      .prepare(
        `SELECT t.total AS total,
                (SELECT COUNT(*) FROM totals x WHERE x.total > t.total)
              + (SELECT COUNT(*) FROM totals x WHERE x.total = t.total AND x.last < t.last) + 1 AS rank
         FROM totals t WHERE t.player = ?`
      )
      .bind(player)
      .first();
    if (o) me.overall = { rank: o.rank, total: o.total };
    if (level != null) {
      const l = await db
        .prepare(
          `SELECT b.score AS score,
                  (SELECT COUNT(*) FROM best x WHERE x.level = b.level AND x.score > b.score)
                + (SELECT COUNT(*) FROM best x WHERE x.level = b.level AND x.score = b.score AND x.created_at < b.created_at) + 1 AS rank
           FROM best b WHERE b.level = ? AND b.player = ?`
        )
        .bind(level, player)
        .first();
      if (l) me.level = { rank: l.rank, score: l.score };
    }
    const p = await db.prepare('SELECT name FROM players WHERE player = ?').bind(player).first();
    if (p) me.name = p.name;
    out.me = me;
  }
  return out;
}

// ---------------------------------------------------------------- handlers
async function tickets(url, env, E, now) {
  if (!env.SEED_SECRET) return fail(503, 'not_ready', 'The scoreboard is still waking up.');
  const player = cleanPlayer(url.searchParams.get('player'));
  if (!player) return fail(400, 'player', 'Missing player id.');
  const levels = [...new Set(String(url.searchParams.get('levels') || '').split(',').filter((x) => x !== '').map(Number))];
  if (!levels.length || !levels.every((l) => Number.isInteger(l) && l >= 0 && l < E.LEVELS.length)) {
    return fail(400, 'level', 'No such level.');
  }
  const exp = now() + TICKET_TTL;
  const rnd = crypto.getRandomValues(new Uint32Array(levels.length));
  const seeds = [];
  for (let i = 0; i < levels.length; i++) {
    const seed = (rnd[i] % 2147483646) + 1;
    seeds.push({ level: levels[i], seed, exp, sig: await signTicket(env.SEED_SECRET, player, levels[i], seed, exp) });
  }
  return json({ ok: true, seeds });
}

async function submit(request, env, E, VERSION, now) {
  const body = await readJson(request);
  if (!body) return fail(400, 'bad_request', 'That score got scrambled.');
  if (body.v !== VERSION) return fail(409, 'version', 'The game was updated. Refresh the page to post scores.');
  const player = cleanPlayer(body.player);
  if (!player) return fail(400, 'player', 'Missing player id.');
  const name = cleanName(body.name);
  if (!name) return fail(400, 'name', 'Please pick different initials.');
  const level = body.level;
  if (!Number.isInteger(level) || level < 0 || level >= E.LEVELS.length) return fail(400, 'level', 'No such level.');
  const { seed, exp, sig } = body;
  if (!Number.isInteger(seed) || seed < 1 || seed > 0x7fffffff) return fail(400, 'seed', 'Bad seed.');
  if (!Number.isInteger(exp) || typeof sig !== 'string' || !/^[a-f0-9]{32}$/.test(sig)) {
    return fail(400, 'ticket', "That game wasn't played on a board ticket.");
  }
  if (!env.SEED_SECRET) return fail(503, 'not_ready', 'The scoreboard is still waking up.');
  if (!sameSig(sig, await signTicket(env.SEED_SECRET, player, level, seed, exp))) {
    return fail(403, 'ticket', "That game's board ticket doesn't check out.");
  }
  if (exp < now()) return fail(403, 'ticket', "That game's board ticket ran out.");
  const moves = parseMoves(body.moves, E.LEVELS[level].moves);
  if (!moves) return fail(400, 'moves', 'Bad move list.');

  const result = replay(E, level, seed, moves);
  if (!result.ok) return fail(422, 'replay', result.why);

  const db = env.DB;
  const played = fnv1a(JSON.stringify(moves));
  const used = await db.prepare('SELECT player, moves FROM used_seeds WHERE sig = ?').bind(sig).first();
  if (used) {
    // A retry of a post that already landed is fine; a second game on the same board isn't.
    if (used.player !== player || used.moves !== played) return fail(409, 'seed_used', 'That board was already played. Try a fresh one!');
    return json({ ok: true, score: result.score, stars: result.stars, improved: false, ...(await boards(db, level, player)) });
  }

  const t = now();
  const prev = await db.prepare('SELECT score FROM best WHERE player = ? AND level = ?').bind(player, level).first();
  const improved = !prev || result.score > prev.score;
  const writes = [
    db.prepare('INSERT INTO used_seeds (sig, player, level, moves, at) VALUES (?, ?, ?, ?, ?)').bind(sig, player, level, played, t),
    db
      .prepare(
        `INSERT INTO players (player, name, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(player) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
      )
      .bind(player, name, t),
  ];
  if (improved) {
    writes.push(
      db
        .prepare(
          `INSERT INTO best (player, level, score, stars, seed, moves, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(player, level) DO UPDATE SET score = excluded.score, stars = excluded.stars,
             seed = excluded.seed, moves = excluded.moves, created_at = excluded.created_at
           WHERE excluded.score > best.score`
        )
        .bind(player, level, result.score, result.stars, seed, JSON.stringify(moves), t),
      db
        .prepare(
          `INSERT INTO totals (player, total, levels, stars, last)
           SELECT player, SUM(score), COUNT(*), SUM(stars), MAX(created_at) FROM best WHERE player = ? GROUP BY player
           ON CONFLICT(player) DO UPDATE SET total = excluded.total, levels = excluded.levels,
             stars = excluded.stars, last = excluded.last`
        )
        .bind(player)
    );
  }
  try {
    await db.batch(writes);
  } catch (err) {
    if (/UNIQUE|constraint/i.test(String(err && err.message))) return fail(409, 'seed_used', 'That board was already played. Try a fresh one!');
    throw err;
  }
  forget(db);
  return json({ ok: true, score: result.score, stars: result.stars, improved, ...(await boards(db, level, player)) });
}

async function rename(request, env, now) {
  const body = await readJson(request);
  const player = body && cleanPlayer(body.player);
  if (!player) return fail(400, 'player', 'Missing player id.');
  const name = cleanName(body.name);
  if (!name) return fail(400, 'name', 'Please pick different initials.');
  await env.DB.prepare('UPDATE players SET name = ?, updated_at = ? WHERE player = ?').bind(name, now(), player).run();
  forget(env.DB);
  return json({ ok: true, name });
}

export async function handle(request, env, ctx) {
  const { E, VERSION } = ctx;
  const now = ctx.now || Date.now;
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    if (url.pathname === '/' || url.pathname === '/v1') {
      return json({ ok: true, game: 'purrfect-match-64', version: VERSION, levels: E.LEVELS.length });
    }
    if (url.pathname === '/v1/boards' && request.method === 'GET') {
      if (await limited(env, 'RL_READS', request)) return slowDown();
      const raw = url.searchParams.get('level');
      const level = raw == null || raw === '' ? null : Number(raw);
      if (level != null && !(Number.isInteger(level) && level >= 0 && level < E.LEVELS.length)) return fail(400, 'level', 'No such level.');
      const player = cleanPlayer(url.searchParams.get('player'));
      return json({ ok: true, version: VERSION, ...(await boards(env.DB, level, player)) });
    }
    if (url.pathname === '/v1/seeds' && request.method === 'GET') {
      if (await limited(env, 'RL_SEEDS', request)) return slowDown();
      if (!cleanPlayer(url.searchParams.get('player'))) return fail(400, 'player', 'Missing player id.');
      if (await overDailyBudget(env, request, now)) return slowDown();
      return await tickets(url, env, E, now);
    }
    if (url.pathname === '/v1/scores' && request.method === 'POST') {
      if (await limited(env, 'RL_POSTS', request)) return slowDown();
      return await submit(request, env, E, VERSION, now);
    }
    if (url.pathname === '/v1/name' && request.method === 'POST') {
      if (await limited(env, 'RL_POSTS', request)) return slowDown();
      return await rename(request, env, now);
    }
    return fail(404, 'not_found', 'Nothing here but kitties.');
  } catch (err) {
    console.error(err);
    return fail(500, 'server', 'The scoreboard tripped over some yarn. Try again soon.');
  }
}
