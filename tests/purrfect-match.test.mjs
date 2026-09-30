// Tests for the Purrfect Match 64 engine. Run with: node --test tests/
//
// The game ships as one self-contained HTML file, so these tests pull the
// pure-logic <script id="purr-engine"> block straight out of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../purrfect-match/index.html', import.meta.url), 'utf8');
const engineSrc = html.match(/<script id="purr-engine">([\s\S]*?)<\/script>/)[1];
vm.runInThisContext(engineSrc);
const E = globalThis.PurrEngine;

const LEVEL = { name: 'TEST', moves: 20, colors: 6, score: 999999 };

// Build a state from a picture. Digits are kitty colours, 'R' a rainbow
// kitty, 'x'/'X' boxes, '#' no cell. `kinds` turns pieces into specials,
// e.g. { '3,4': 'h' }.
function board(rows, kinds = {}, level = LEVEL, seed = 7) {
  const s = E.newGame(level, seed);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const ch = rows[r][c];
      s.mask[r][c] = ch !== '#';
      if (ch === '#') s.grid[r][c] = null;
      else if (ch === 'R') s.grid[r][c] = { id: s.nextId++, color: -1, kind: 'r' };
      else if (ch === 'x' || ch === 'X') s.grid[r][c] = { id: s.nextId++, color: -1, kind: 'x', hp: ch === 'x' ? 1 : 2 };
      else s.grid[r][c] = { id: s.nextId++, color: Number(ch), kind: 'n' };
    }
  }
  for (const [pos, kind] of Object.entries(kinds)) {
    const [r, c] = pos.split(',').map(Number);
    s.grid[r][c].kind = kind;
  }
  return s;
}

// A match-free filler: colour = (c + 2r) mod 5, so colour 5 is free for setups.
const BASE = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => String((c + 2 * r) % 5)).join(''));
const withCells = (cells) => {
  const rows = BASE.map((row) => row.split(''));
  for (const [pos, ch] of Object.entries(cells)) {
    const [r, c] = pos.split(',').map(Number);
    rows[r][c] = ch;
  }
  return rows.map((row) => row.join(''));
};

const clearedCells = (step) => new Set(step.clears.map((x) => `${x.r},${x.c}`));

function assertSettled(s) {
  const ids = new Set();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = s.grid[r][c];
      if (!s.mask[r][c]) {
        assert.equal(p, null, `hole at ${r},${c} should stay empty`);
        continue;
      }
      assert.ok(p, `cell ${r},${c} should be filled`);
      assert.ok(!ids.has(p.id), `piece id ${p.id} is duplicated`);
      ids.add(p.id);
    }
  }
  assert.equal(E.findMatches(s).length, 0, 'board should have no matches left');
}

test('the base filler really is match-free', () => {
  assert.equal(E.findMatches(board(BASE)).length, 0);
});

test('levels are well formed', () => {
  assert.equal(E.LEVELS.length, 20);
  for (const [i, lv] of E.LEVELS.entries()) {
    const where = `level ${i + 1}`;
    assert.ok(lv.name && lv.moves > 0, where);
    assert.ok(lv.colors === 5 || lv.colors === 6, where);
    assert.equal(lv.stars.length, 3, where);
    assert.ok(lv.stars[0] <= lv.stars[1] && lv.stars[1] <= lv.stars[2], `${where} stars ascend`);
    for (const [color, n] of lv.collect || []) assert.ok(color < lv.colors && n > 0, where);
    if (lv.layout) {
      assert.equal(lv.layout.length, 8, where);
      for (const row of lv.layout) assert.match(row, /^[#.hHxX]{8}$/, where);
    }
    const s = E.newGame(lv, 1);
    assert.ok(E.goalProgress(s).length > 0, `${where} has a goal`);
    assert.equal(E.status(s), 'playing', where);
  }
});

test('new boards start with no matches and at least one move', () => {
  for (const lv of E.LEVELS) {
    for (let seed = 1; seed <= 15; seed++) {
      const s = E.newGame(lv, seed);
      assertSettled(s);
      assert.ok(E.hasMove(s), `${lv.name} seed ${seed} has a move`);
      const boxes = s.grid.flat().filter((p) => p && p.kind === 'x').length;
      assert.equal(boxes, s.goals.boxes, `${lv.name} boxes are placed`);
    }
  }
});

test('match shapes make the right special', () => {
  const cases = [
    [{ '3,0': '5', '3,1': '5', '3,2': '5' }, null],
    [{ '3,0': '5', '3,1': '5', '3,2': '5', '3,3': '5' }, 'h'],
    [{ '1,4': '5', '2,4': '5', '3,4': '5', '4,4': '5' }, 'v'],
    [{ '3,0': '5', '3,1': '5', '3,2': '5', '3,3': '5', '3,4': '5' }, 'r'],
    [{ '3,0': '5', '3,1': '5', '3,2': '5', '4,0': '5', '5,0': '5' }, 'y'],
    [{ '3,0': '5', '3,1': '5', '3,2': '5', '4,1': '5', '5,1': '5' }, 'y'],
    [{ '3,3': '5', '3,4': '5', '4,3': '5', '4,4': '5' }, 'b'],
  ];
  for (const [cells, special] of cases) {
    const groups = E.findMatches(board(withCells(cells)));
    assert.equal(groups.length, 1, JSON.stringify(cells));
    assert.equal(groups[0].special, special, JSON.stringify(cells));
    assert.equal(groups[0].cells.length, Object.keys(cells).length);
  }
});

test('a swap that makes no match is refused and costs nothing', () => {
  const s = board(BASE);
  const before = JSON.stringify(s.grid);
  const res = E.playMove(s, { type: 'swap', a: [0, 0], b: [0, 1] });
  assert.equal(res.ok, false);
  assert.equal(s.movesLeft, 20);
  assert.equal(JSON.stringify(s.grid), before);
});

test('non-adjacent swaps and box swaps are refused', () => {
  const s = board(withCells({ '0,0': 'x' }));
  assert.equal(E.playMove(s, { type: 'swap', a: [2, 2], b: [2, 4] }).ok, false);
  assert.equal(E.playMove(s, { type: 'swap', a: [0, 0], b: [0, 1] }).ok, false);
});

test('a matching swap clears the kitties, scores, and settles', () => {
  const s = board(withCells({ '3,0': '5', '3,1': '5', '4,2': '5' }));
  const res = E.playMove(s, { type: 'swap', a: [4, 2], b: [3, 2] });
  assert.equal(res.ok, true);
  assert.equal(s.movesLeft, 19);
  const cleared = clearedCells(res.steps[0]);
  for (const cell of ['3,0', '3,1', '3,2']) assert.ok(cleared.has(cell), cell);
  assert.ok(s.score >= 30);
  assert.ok(s.progress.collected[5] >= 3);
  assertSettled(s);
});

test('a match of 4 leaves zoomies where the kitty was moved to', () => {
  const s = board(withCells({ '3,0': '5', '3,1': '5', '3,3': '5', '4,2': '5' }));
  const res = E.playMove(s, { type: 'swap', a: [4, 2], b: [3, 2] });
  assert.deepEqual(JSON.parse(JSON.stringify(res.steps[0].created.map((x) => [x.r, x.c, x.piece.kind, x.piece.color]))), [[3, 2, 'h', 5]]);
});

test('row zoomies clear the whole row', () => {
  const s = board(withCells({ '3,0': '5', '3,1': '5', '4,2': '5' }), { '3,1': 'h' });
  const res = E.playMove(s, { type: 'swap', a: [4, 2], b: [3, 2] });
  const cleared = clearedCells(res.steps[0]);
  for (let c = 0; c < 8; c++) assert.ok(cleared.has(`3,${c}`), `3,${c}`);
  assert.ok(res.steps[0].effects.some((e) => e.type === 'row' && e.r === 3));
});

test('column zoomies clear the whole column', () => {
  const s = board(withCells({ '3,0': '5', '3,1': '5', '4,2': '5' }), { '3,0': 'v' });
  const res = E.playMove(s, { type: 'swap', a: [4, 2], b: [3, 2] });
  const cleared = clearedCells(res.steps[0]);
  for (let r = 0; r < 8; r++) assert.ok(cleared.has(`${r},0`), `${r},0`);
});

test('yarn balls clear a 3x3 patch', () => {
  const s = board(withCells({ '3,0': '5', '3,1': '5', '4,2': '5' }), { '3,1': 'y' });
  const res = E.playMove(s, { type: 'swap', a: [4, 2], b: [3, 2] });
  const cleared = clearedCells(res.steps[0]);
  for (let r = 2; r <= 4; r++) for (let c = 0; c <= 2; c++) assert.ok(cleared.has(`${r},${c}`), `${r},${c}`);
});

test('a rainbow kitty swapped with a kitty clears every kitty of that colour', () => {
  const s = board(withCells({ '5,5': 'R' }));
  const target = s.grid[5][6].color;
  const onBoard = s.grid.flat().filter((p) => p && p.kind === 'n' && p.color === target).length;
  const res = E.playMove(s, { type: 'swap', a: [5, 5], b: [5, 6] });
  assert.equal(res.ok, true);
  const first = res.steps[0];
  assert.equal(first.clears.filter((x) => x.color === target).length, onBoard);
  assert.ok(first.clears.some((x) => x.kind === 'r'));
  assertSettled(s);
});

test('a rainbow kitty plus zoomies turns that whole colour into zoomies', () => {
  const s = board(withCells({ '5,5': 'R' }), { '5,6': 'h' });
  const target = s.grid[5][6].color;
  const normals = s.grid.flat().filter((p) => p && p.kind === 'n' && p.color === target).length;
  const res = E.playMove(s, { type: 'swap', a: [5, 6], b: [5, 5] });
  const first = res.steps[0];
  assert.equal(first.transforms.length, normals);
  assert.ok(first.transforms.every((x) => x.kind === 'h' || x.kind === 'v'));
  assert.ok(first.effects.filter((e) => e.type === 'row' || e.type === 'col').length >= normals);
});

test('two rainbow kitties clear the entire board', () => {
  const s = board(withCells({ '2,2': 'R', '2,3': 'R' }));
  const res = E.playMove(s, { type: 'swap', a: [2, 2], b: [2, 3] });
  assert.equal(res.steps[0].clears.length, 64);
  assertSettled(s);
});

test('two zoomies make a cross', () => {
  const s = board(BASE, { '4,4': 'h', '4,5': 'v' });
  const res = E.playMove(s, { type: 'swap', a: [4, 4], b: [4, 5] });
  const cleared = clearedCells(res.steps[0]);
  for (let i = 0; i < 8; i++) {
    assert.ok(cleared.has(`4,${i}`), `row 4,${i}`);
    assert.ok(cleared.has(`${i},5`), `col ${i},5`);
  }
});

test('two yarn balls make a 5x5 burst', () => {
  const s = board(BASE, { '4,4': 'y', '4,5': 'y' });
  const res = E.playMove(s, { type: 'swap', a: [4, 4], b: [4, 5] });
  const cleared = clearedCells(res.steps[0]);
  // centred on (4,5), where the moved yarn ball landed
  for (let r = 2; r <= 6; r++) for (let c = 3; c <= 7; c++) assert.ok(cleared.has(`${r},${c}`), `${r},${c}`);
});

test('butterflies go after sleepy boxes first', () => {
  const s = board(withCells({ '0,7': 'x', '3,3': '5', '3,4': '5', '4,3': '5', '5,4': '5' }), { '3,3': 'b' });
  const res = E.playMove(s, { type: 'swap', a: [5, 4], b: [4, 4] });
  assert.equal(res.ok, true);
  const fly = res.steps[0].effects.find((e) => e.type === 'fly');
  assert.ok(fly, 'butterfly flew');
  assert.deepEqual([...fly.to], [0, 7]);
  assert.equal(s.progress.boxesWoken, 1);
});

test('a match next to a box wakes it, a taped box needs two', () => {
  const s = board(withCells({ '2,1': 'x', '4,1': 'X', '3,0': '5', '3,1': '5', '4,2': '5' }), {}, { name: 'boxes', moves: 20, colors: 6, layout: ['........', '........', '.x......', '........', '.X......', '........', '........', '........'] });
  const res = E.playMove(s, { type: 'swap', a: [4, 2], b: [3, 2] });
  const first = res.steps[0];
  assert.deepEqual(first.boxHits.map((h) => h.hp).sort(), [0, 1]);
  assert.equal(first.clears.filter((x) => x.kind === 'x').length, 1);
});

test('hearts pop under cleared kitties, double hearts need two pops', () => {
  const lv = { name: 'hearts', moves: 20, colors: 6, layout: ['........', '........', '........', 'hH......', '........', '........', '........', '........'] };
  const s = board(withCells({ '3,0': '5', '3,1': '5', '4,2': '5' }), {}, lv);
  assert.equal(s.progress.heartsLeft, 3);
  E.playMove(s, { type: 'swap', a: [4, 2], b: [3, 2] });
  assert.equal(s.hearts[3][0], 0);
  assert.ok(s.hearts[3][1] <= 1);
  assert.equal(s.progress.heartsLeft, s.hearts[3][1]);
});

test('tapping a special sets it off and costs a move', () => {
  const s = board(BASE, { '6,6': 'y' });
  assert.equal(E.playMove(s, { type: 'tap', a: [0, 0] }).ok, false);
  const res = E.playMove(s, { type: 'tap', a: [6, 6] });
  assert.equal(res.ok, true);
  assert.equal(s.movesLeft, 19);
  assert.equal(res.steps[0].clears.length, 9);
});

test('holes stay empty and pieces never fall into them', () => {
  const rows = withCells({ '0,0': '#', '0,7': '#', '7,0': '#', '3,1': '5', '3,2': '5', '4,3': '5' });
  const s = board(rows);
  const res = E.playMove(s, { type: 'swap', a: [4, 3], b: [3, 3] });
  assert.equal(res.ok, true);
  assertSettled(s);
});

test('shuffling keeps the pieces, removes matches and leaves a move', () => {
  const s = E.newGame(E.LEVELS[0], 3);
  const ids = s.grid.flat().map((p) => p.id).sort((a, b) => a - b);
  const sh = E.shuffleBoard(s);
  assert.equal(sh.moves.length, 64);
  assert.deepEqual(s.grid.flat().map((p) => p.id).sort((a, b) => a - b), ids);
  assertSettled(s);
  assert.ok(E.hasMove(s));
});

test('the same seed and moves always replay the same game', () => {
  const play = () => {
    const s = E.newGame(E.LEVELS[6], 42);
    for (let i = 0; i < 10; i++) E.playMove(s, E.findHint(s));
    return [s.score, JSON.stringify(s.grid)];
  };
  assert.deepEqual(play(), play());
});

test('winning ends the level and the bonus round spends leftover moves', () => {
  const s = board(withCells({ '3,0': '5', '3,1': '5', '4,2': '5' }), {}, { name: 'easy', moves: 10, colors: 6, score: 10, stars: [10, 20, 30] });
  E.playMove(s, { type: 'swap', a: [4, 2], b: [3, 2] });
  assert.equal(E.status(s), 'won');
  assert.equal(E.playMove(s, E.findHint(s) || { type: 'tap', a: [0, 0] }).ok, false);
  const before = s.score;
  const steps = E.bonusRound(s);
  assert.equal(s.movesLeft, 0);
  assert.ok(steps.length > 0);
  assert.ok(s.score >= before + 9 * 100);
  assert.ok(!s.grid.flat().some((p) => p && E.isSpecial(p)), 'no specials left behind');
  assertSettled(s);
});

test('running out of moves loses', () => {
  const s = board(withCells({ '3,0': '5', '3,1': '5', '4,2': '5' }), {}, { name: 'hard', moves: 1, colors: 6, score: 999999, stars: [1, 2, 3] });
  E.playMove(s, { type: 'swap', a: [4, 2], b: [3, 2] });
  assert.equal(E.status(s), 'lost');
});

test('cozy mode never ends', () => {
  const s = E.newGame(E.COZY, 5);
  for (let i = 0; i < 30; i++) {
    const mv = E.findHint(s);
    assert.ok(mv, 'always a move available');
    assert.equal(E.playMove(s, mv).ok, true);
  }
  assert.equal(E.status(s), 'playing');
  assertSettled(s);
});

test('fuzz: random valid moves on every level keep the board healthy', () => {
  for (const [i, lv] of E.LEVELS.entries()) {
    const s = E.newGame(lv, 100 + i);
    for (let turn = 0; turn < 40 && E.status(s) === 'playing'; turn++) {
      const moves = E.listMoves(s);
      assert.ok(moves.length > 0, `${lv.name} turn ${turn} has moves`);
      const mv = moves[(turn * 7919 + i) % moves.length];
      const res = E.playMove(s, mv);
      assert.equal(res.ok, true);
      for (const step of res.steps) {
        assert.ok(step.duration >= 0 && Number.isFinite(step.duration));
        for (const f of step.falls) assert.ok(f.toR > f.fromR, 'pieces only fall down');
      }
      assertSettled(s);
    }
    if (E.status(s) === 'won') {
      E.bonusRound(s);
      assertSettled(s);
    }
  }
});
