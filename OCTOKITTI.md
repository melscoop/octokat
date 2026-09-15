# 🐙🐱 octokitti

**gitfiti, but the only palette is octocats.**

Your GitHub contribution graph is a 7-row, 53-column, 5-shade display. That is a
perfectly good pixel canvas going to waste. `octokitti` fills it with octocats by
creating backdated empty commits, one per shade level per day.

No dependencies. Just Python 3.8+ and `git`.

```
     Ma      Ap      Ma        Ju      Ju      Au        Se
Sun   . . . . . . . . . . . . # # . . . # # . . . . * . * .
Mon   . * . . . . . * . . . # # # # # # # # # . . . # # # .
Tue   . # # # # # # # . . . # # # # # # # # # . . # - # - #
Wed   # # - - # - - # # . . . # # # # # # # . . . # # # # #
Thu   # # # # # # # # # . . . . # # # # # . . . . . # # # .
Fri   . # # # # # # # . . . . . . # # # . . . . . # . # . #
Sat   . . * * * * * . . . . . . . . # . . . . . . + . . . +
              loaf              heart          kitten
```

## Quick start

```sh
# see the whole litter
python3 octokitti.py list

# render one (or several) without touching git
python3 octokitti.py preview octoface
python3 octokitti.py preview loaf heart kitten --gap 2
python3 octokitti.py preview prowl prowl:flip --gap 2

# dry run against a throwaway repo
python3 octokitti.py paint octoface --repo ../kat-canvas

# actually do it
python3 octokitti.py paint octoface --repo ../kat-canvas --yes

# regret it
python3 octokitti.py undo --repo ../kat-canvas --yes
```

## Watch it move

`animate` plays the art in your terminal, redrawing in place.

```sh
# paint it on, week by week, the way `paint` actually commits it
python3 octokitti.py animate octoface

# blink
python3 octokitti.py animate loaf --mode blink --loops 0

# a parade of the whole litter, one kat at a time
python3 octokitti.py animate
```

| mode | what happens |
| --- | --- |
| `fill` | The art reveals one week per frame, with a running week counter. Default when you name a kat. |
| `blink` | The kat sits there and blinks. Eyes are the level-1 pixels, so darkening them to body shade closes them. |
| `parade` | Every named kat in turn, centred, captioned. Default when you name none. |

`--fps` sets the speed (default 12), `--loops 0` runs until you hit `Ctrl-C`.
Frames are cropped to your terminal width, because a wrapped frame corrupts the
redraw. Piping the output somewhere non-interactive just prints the final frame,
so it stays safe in scripts.

Then `git push` the canvas repo to GitHub. The graph counts commits in **public**
repos (or private ones, if you enable *Private contributions* in your profile
settings), and the commit author email must match one on your GitHub account.

## The kats

Fourteen of them. Every face has proper 2×2 eyes and most have blushy cheeks,
because a one-pixel eye is not cute, it is a typo.

| kat | width | what it is |
| --- | --- | --- |
| `octoface` | 9 | The classic octocat. Big round eyes, blushy cheeks, tentacles down. |
| `mona` | 11 | Mona Lisa Octocat, hair and all. The wide one. |
| `kitten` | 5 | A smol octokitten. Fits absolutely anywhere. |
| `loaf` | 9 | An octokat folded into a perfect loaf. No legs, no regrets. |
| `sleepy` | 10 | Mid-nap. Eyes squeezed shut, cheeks warm, little `zzz`. |
| `blep` | 9 | Tongue out, no thoughts. A classic blep. |
| `wink` | 9 | One eye shut, entirely on purpose. Very smooth. |
| `bowtie` | 9 | A dapper octokat. Dressed for the commit. |
| `prowl` | 10 | An octokat in profile, tail up, one eye on you. |
| `heart` | 9 | A heart, for the kat who deserves it. |
| `yarn` | 8 | A ball of yarn with the string trailing off. |
| `fish` | 8 | A snack. |
| `paws` | 11 | Two paw prints padding across the graph. |
| `tentacle` | 8 | A single curling tentacle. Good as a spacer. |

The graph shows about 53 weeks, so you can fit roughly five kats side by side.

### Combos worth trying

```sh
python3 octokitti.py preview loaf heart kitten --gap 2   # a family portrait
python3 octokitti.py preview prowl fish                  # the hunt
python3 octokitti.py preview prowl prowl:flip --gap 2    # nose to nose
python3 octokitti.py preview kitten --repeat 5           # a whole litter
python3 octokitti.py preview random random --gap 2       # let fate decide
```

## Kat specs

Anywhere a kat name is accepted you can also write:

| spec | means |
| --- | --- |
| `octoface` | a bundled kat |
| `octoface:flip` | mirrored horizontally, so it faces the other way |
| `random` | a surprise from the bundled litter |
| `./my-kat.kat` | a kat file of your own |

## Drawing your own kat

A `.kat` file is exactly 7 lines — one per weekday, Sunday first. Each character
is a shade from `0` to `4`, and `.` or a space means "leave it blank".

```
# name: my-kat
# desc: a kat of my very own
.3.....3.
.4444444.
441141144
441141144
.2444442.
4.4.4.4.4
2.2.2.2.2
```

Cuteness is mostly shading discipline: `4` for the body, `1` for eyes (the
contrast is what makes them read as eyes), `2` for blush and other soft bits,
and `3` for ears and outlines. Two-by-two eyes beat one-pixel eyes every time.

Drop it in `kats/` and it shows up in `list`, or point straight at it:

```sh
python3 octokitti.py preview ./my-kat.kat
```

Rows may be ragged — short rows are padded with blanks on the right.

## Options

| flag | default | does what |
| --- | --- | --- |
| `--start YYYY-MM-DD` | last complete week, right-aligned | First Sunday of the art. Non-Sundays snap backwards. |
| `--multiplier N` | `1` | Commits per shade level. Raise it if your real commits drown out the kat. |
| `--gap N` | `1` | Blank columns between kats. |
| `--repeat N` | `1` | Repeat the whole composition N times. |
| `--mode` | `fill` / `parade` | For `animate`: `fill`, `blink` or `parade`. |
| `--fps N` | `12` | For `animate`: frames per second. |
| `--loops N` | `3` | For `animate`: times to repeat, `0` for forever. |
| `--ascii` | off | Plain ASCII instead of colour blocks. |
| `--repo PATH` | required for `paint`/`undo` | Which repo to scribble in. |
| `--yes` | off | Actually do the thing. Without it, everything is a dry run. |
| `--force` | off | For `undo`: reset even if unrelated commits landed on top. |

### Shading

Your kat competes with your real commits for contrast. GitHub's shade buckets are
relative to your busiest day, so if you normally push 20 commits a day, a
`--multiplier 1` kat will be invisible. Bump the multiplier until the darkest
pixels out-rank your ordinary days.

## Safety rails

`octokitti` rewrites history, so it tries hard not to surprise you:

- **Dry run by default.** `paint` and `undo` do nothing without `--yes`.
- **Refuses a dirty tree.** Commit or stash before painting.
- **Records where it started.** The pre-paint `HEAD` is saved to
  `.git/octokitti-state.json`, and `undo` resets back to it.
- **Won't clobber real work.** `undo` inspects every commit it would drop and
  bails if any of them lacks the `Octokitti-Paint` trailer.
- **Warns about invisible art.** Dates in the future, or more than a year back,
  won't render on the graph — you get told before you commit.

Still: **paint in a dedicated throwaway repo**, not one anybody depends on.

## Tests

```sh
python3 -m unittest discover -s tests
```

## Prior art

Inspired by [gitfiti](https://github.com/gelstudios/gitfiti), which let you draw
anything. This one has opinions.
