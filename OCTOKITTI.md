# 🐙🐱 octokitti

**gitfiti, but the only palette is octocats.**

Your GitHub contribution graph is a 7-row, 53-column, 5-shade display. That is a
perfectly good pixel canvas going to waste. `octokitti` fills it with octocats by
creating backdated empty commits, one per shade level per day.

No dependencies. Just Python 3.8+ and `git`.

```
     Fe    Ma        Ap      Ma        Ju      Ju      Au        Se
Sun   . . . . . . . * . * . . . . * # # # . . . . . * . . . . . * .
Mon   * . . . . . . # # # . . . * # . . # * . . . . # # # # # # # .
Tue   . * . . . . # # # # . . * # . . . . # * . . # # # - # - # # #
Wed   . * # # # # # # # . . . * # . . . . . . . . # # # # # # # # #
Thu   . . # # # # # # # . . . . * # . . . . . . . . # # # # # # # .
Fri   . . # . # . # . # . . . . . * # # . . . . . # . # . # . # . #
Sat   . . * . * . * . * . . . . . . . * * * . . . + . + . + . + . +
```

## Quick start

```sh
# see the whole litter
python3 octokitti.py list

# render one (or several) without touching git
python3 octokitti.py preview octoface
python3 octokitti.py preview prowl tentacle octoface --gap 2

# dry run against a throwaway repo
python3 octokitti.py paint octoface --repo ../kat-canvas

# actually do it
python3 octokitti.py paint octoface --repo ../kat-canvas --yes

# regret it
python3 octokitti.py undo --repo ../kat-canvas --yes
```

Then `git push` the canvas repo to GitHub. The graph counts commits in **public**
repos (or private ones, if you enable *Private contributions* in your profile
settings), and the commit author email must match one on your GitHub account.

## The kats

| kat | width | what it is |
| --- | --- | --- |
| `octoface` | 9 weeks | The classic octocat. Ears up, eyes wide, tentacles down. |
| `mona` | 11 weeks | Mona Lisa Octocat, hair and all. The wide one. |
| `sleepy` | 10 weeks | An octokat mid-nap, with a little `zzz`. |
| `prowl` | 10 weeks | An octokat in profile, tail up, on the prowl. |
| `tentacle` | 8 weeks | A single curling tentacle. Good as a spacer. |
| `paws` | 11 weeks | Two paw prints padding across the graph. |

The graph shows about 53 weeks, so you can fit roughly five kats side by side.

## Drawing your own kat

A `.kat` file is exactly 7 lines — one per weekday, Sunday first. Each character
is a shade from `0` to `4`, and `.` or a space means "leave it blank".

```
# name: my-kat
# desc: a kat of my very own
.3.....3.
.4444444.
444141444
444444444
.4444444.
4.4.4.4.4
2.2.2.2.2
```

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
