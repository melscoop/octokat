# 🐱✨ Purrfect Match 64

**A super cute pixel-art kitty match-3.** Swap kitties, line up three of a kind,
and make zoomies, yarn balls, butterflies and rainbow kitties.

**▶ [Play it](https://melscoop.github.io/octokat/purrfect-match/)**, or just open
[`purrfect-match/index.html`](purrfect-match/index.html) in a browser. It's one
self-contained file: no installs, no downloads, works offline and on phones.

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

## How it's built

`purrfect-match/index.html` holds two scripts:

- `<script id="purr-engine">`: the pure game rules (matching, specials, combos,
  gravity, shuffling, goals, levels). It never touches the page, and it's
  seeded, so the same seed and moves always replay the same game.
- `<script id="purr-game">`: pixel-art painting, the bitmap font, sound, scenes,
  animation, and input. It turns each engine step into animation.

The level difficulty and star thresholds were tuned by letting a greedy bot play
every level many times.

## Tests

```sh
node --test tests/
```

The tests load the engine straight out of `index.html`. They cover match shapes,
every special and combo, boxes, hearts, board shapes, shuffling, determinism,
winning and losing, plus a fuzz run through all 20 levels.
