# 🐱✨ Purrfect Match 64

**A super cute pixel-art kitty match-3.** Swap kitties, line up three of a kind,
make zoomies, yarn balls, butterflies and rainbow kitties, and climb the global
**Top Kitties** leaderboard.

**▶ [Play it](https://melscoop.github.io/octokat/purrfect-match/)**, or just open
[`purrfect-match/index.html`](purrfect-match/index.html) in a browser. It's one
self-contained file: no installs, no downloads, and it works on phones. The game
plays offline too; only the leaderboard needs a connection.

Every sprite is drawn pixel by pixel on a tiny 180×320 screen and scaled up with
crisp nearest-neighbour pixels. The music and sound effects (meows included) are
synthesised on the fly with Web Audio.

## The kitties

Six kitties, each with its own look as well as its own colour, so you can tell
them apart even if colours are hard to see.

| kitty | colour | look |
| --- | --- | --- |
| Mochi | pink | a little red bow |
| Mango | orange | tabby stripes |
| Lemon | yellow | a daisy on one ear |
| Minty | mint | a leaf sprout |
| Bluebell | blue | a golden bell |
| Grape | purple | folded ears and a heart |

## How to play

Swap two kitties that are side by side to make a line of three or more of the
same kind. **Drag** a kitty onto its neighbour, or **tap** one and then the other.
Finish every goal at the top before you run out of moves.

| control | does |
| --- | --- |
| drag, or tap two neighbours | swap |
| tap a special twice | set it off, costs a move |
| arrow keys | move the cursor, or swap once a kitty is picked |
| Enter / Space | pick up or set off the kitty under the cursor |
| tap the goals, or G / ? | show what each goal means |
| Esc | pause |
| M | music on/off |

## Special kitties

Bigger matches leave a special behind. Specials glow. Match them, swap them, or
tap them twice to set them off.

| special | how to make it | what it does |
| --- | --- | --- |
| **Zoomies** | match 4 in a line | dashes across the whole row (or column, if the stripes run up and down) |
| **Yarn ball** | match in an L or T shape | unravels in a fluffy 3×3 burst |
| **Butterfly** | match a 2×2 square | pops its neighbours, then flutters off to boop a tricky spot, like a sleepy box |
| **Rainbow kitty** | match 5 in a line | swap it with any kitty to clear every kitty of that colour |

### Mega combos

Swap two specials into each other:

| combo | result |
| --- | --- |
| zoomies + zoomies | a cross: whole row and column |
| zoomies + yarn ball | triple zoomies: three rows and three columns |
| yarn ball + yarn ball | a huge 5×5 burst |
| butterfly + zoomies or yarn | the butterfly carries the other special somewhere and sets it off |
| butterfly + butterfly | three butterflies |
| rainbow + any special | every kitty of that colour turns into that special, then they all go off |
| rainbow + rainbow | clears the whole board |

## Goals

The top of the screen is the level's legend. Each goal gets its own labelled row,
like **COLLECT PINK KITTIES 12/20** or **POP HEARTS 5/32**. The row fills up as you
go and turns mint with a check mark once it's done. The level's opening banner
lists the goals in full, and tapping the goals any time pauses the game and
explains each one with your progress so far.

| goal | how |
| --- | --- |
| ★ score | reach the target score |
| collect | clear that many kitties of one colour (specials of that colour count) |
| ♥ hearts | match on top of the heart tiles; dark hearts need two pops |
| sleepy boxes | match next to a box, or blast it, to wake the kitty inside; taped boxes need two boops |

When you win, leftover moves turn into zoomies for a **Kitty Party** of bonus
points. Score high enough for up to three stars.

There are **20 levels**, including kitty-face and heart-shaped boards. Each new
idea gets a little intro card the first time you meet it. Progress, stars, and
settings are saved in your browser.

**Cozy mode** has no goals and no move limit: just kitties. It keeps your best
score.

## Global leaderboard

**High scores** on the title screen, **TOP** on the level map, and **BOARD** after
a win all open the Top Kitties board:

- **Overall:** the top 10 players, ranked by their best scores on every level
  added together.
- **Per level:** the top 10 scores on each of the 20 levels.

The title screen has a scrolling ticker of the overall leaders, and new high
scores roll onto the boards as soon as they're posted.

Your first win asks for arcade-style three-letter initials. You can change them
on the board screen. Winning posts your score automatically and shows where it
landed, for example **GLOBAL RANK: 3RD ON THIS LEVEL**. If the board can't be
reached, the win is kept and posted the next time you open the game.

**No cheaty kitties.**
- **Board tickets:** every ranked game is played on a board the server hands
  out. The ticket is signed so it can't be forged, tied to your player and
  level, and good for one post. The game keeps a spare ticket for each level,
  so a game started offline can still be posted later.
- **Replays, not scores:** the game never sends a score. It sends the board and
  the moves you made, and the server replays that exact game with the same
  engine to work out the score. A score only counts if the replay finishes the
  level.
- **Practice mode:** games started with `?seed=` are practice and never posted.
- **Rate limits:** requests are limited per network (per /64 for IPv6, so hopping
  addresses doesn't help). Board tickets also have a daily budget per network,
  so nobody can farm thousands of boards hunting for a lucky one.

**Privacy.** The board stores your initials, a random player ID made on your
device, and the replay of each best game. No accounts, emails, or IP addresses.

## How it's built

`purrfect-match/index.html` holds two scripts:

- `<script id="purr-engine">`: the pure game rules (matching, specials, combos,
  gravity, shuffling, goals, levels). It never touches the page, and it's
  seeded, so the same seed and moves always replay the same game.
- `<script id="purr-game">`: pixel-art painting, the bitmap font, sound, scenes,
  animation, and input. It turns each engine step into animation.

The level difficulty and star thresholds were tuned by letting a greedy bot play
every level many times.

The leaderboard is a [Cloudflare Worker](leaderboard/src/api.js) with a D1
database, in [`leaderboard/`](leaderboard/). Its build step
(`build-engine.mjs`) copies the engine out of `index.html`, so the server replays
games with exactly the game's rules. The game and the Worker both fingerprint
the engine source. If they don't match, posting asks the player to refresh
rather than scoring a game with the wrong rules.

```sh
cd leaderboard
wrangler d1 create purrfect-match-scores        # once; put the id in wrangler.toml
wrangler d1 execute purrfect-match-scores --remote --file schema.sql
openssl rand -hex 32 | wrangler secret put SEED_SECRET   # once; signs board tickets
wrangler deploy                                 # again whenever the engine changes
```

For local testing:
1. Put `SEED_SECRET=anything` in `leaderboard/.dev.vars`.
2. Run `wrangler d1 execute purrfect-match-scores --local --file schema.sql`.
3. Run `wrangler dev`, then open the game with `?api=http://localhost:8787`.

Add `?board=off` to switch the leaderboard off entirely.

The overall board is served from a running `totals` table. The top-10 lists are
cached for a few seconds, so every read stays small. That keeps it well inside
D1's free limits.

## Tests

```sh
node --test tests/
```

The tests load the engine straight out of `index.html`. They cover match shapes,
every special and combo, boxes, hearts, board shapes, shuffling, determinism,
winning and losing, plus a fuzz run through all 20 levels.

The leaderboard tests run the Worker against a real SQLite database. They post
genuine winning games and check rankings and the overall totals. They also try:
- forged, expired, borrowed or reused board tickets
- IPv6 network limits and the daily ticket budget
- tampered replays
- rate limiting
- outdated game versions
- bad initials
- junk requests
