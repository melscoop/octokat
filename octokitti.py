#!/usr/bin/env python3
"""octokitti - gitfiti, but the only palette is octocats.

Paints octocat pixel art onto a GitHub contribution graph by creating
backdated empty commits. Preview first, paint second, undo if you regret it.

    python3 octokitti.py list
    python3 octokitti.py preview octoface mona
    python3 octokitti.py paint octoface --repo ../kat-canvas
    python3 octokitti.py undo --repo ../kat-canvas

Standard library only. No dependencies, no excuses.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROWS = 7
MAX_LEVEL = 4
GRAPH_WEEKS = 53
KAT_DIR = Path(__file__).resolve().parent / "kats"
DAY_LABELS = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
TRAILER = "Octokitti-Paint"
STATE_FILE = "octokitti-state.json"

# 256-colour green ramp, darkest to loudest.
ANSI_RAMP = ("\033[38;5;236m", "\033[38;5;22m", "\033[38;5;28m", "\033[38;5;34m", "\033[38;5;46m")
ANSI_RESET = "\033[0m"
BLOCKS = ("··", "░░", "▒▒", "▓▓", "██")
ASCII_BLOCKS = (" .", " -", " +", " *", " #")


class OctokittiError(Exception):
    """Something went wrong, but politely."""


# --------------------------------------------------------------------------
# Kats
# --------------------------------------------------------------------------


@dataclass
class Kat:
    name: str
    description: str
    grid: list[list[int]]

    @property
    def width(self) -> int:
        return len(self.grid[0]) if self.grid else 0


def parse_kat(text: str, name: str) -> Kat:
    """Parse a .kat file: ``# key: value`` headers plus 7 rows of 0-4 / '.'."""
    description = ""
    rows: list[list[int]] = []

    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("#"):
            header = line.lstrip("#").strip()
            key, sep, value = header.partition(":")
            if sep and key.strip().lower() in ("desc", "description"):
                description = value.strip()
            continue
        if not line.strip():
            continue
        row = []
        for char in line:
            if char in (".", " ", "0"):
                row.append(0)
            elif char in "1234":
                row.append(int(char))
            else:
                raise OctokittiError(
                    f"kat {name!r}: unexpected character {char!r} (use 0-4 or '.')"
                )
        rows.append(row)

    if len(rows) != ROWS:
        raise OctokittiError(f"kat {name!r}: expected {ROWS} rows, found {len(rows)}")

    width = max(len(row) for row in rows)
    if width == 0:
        raise OctokittiError(f"kat {name!r}: is empty")
    grid = [row + [0] * (width - len(row)) for row in rows]
    return Kat(name=name, description=description, grid=grid)


def load_kat(name: str) -> Kat:
    path = Path(name)
    if path.suffix == ".kat" and path.is_file():
        return parse_kat(path.read_text(encoding="utf-8"), path.stem)

    path = KAT_DIR / f"{name}.kat"
    if not path.is_file():
        available = ", ".join(k.name for k in available_kats()) or "none found"
        raise OctokittiError(f"unknown kat {name!r}. Available: {available}")
    return parse_kat(path.read_text(encoding="utf-8"), name)


def available_kats() -> list[Kat]:
    if not KAT_DIR.is_dir():
        return []
    kats = []
    for path in sorted(KAT_DIR.glob("*.kat")):
        kats.append(parse_kat(path.read_text(encoding="utf-8"), path.stem))
    return kats


MODIFIERS = ("flip",)


def flip_kat(kat: Kat) -> Kat:
    """Mirror a kat horizontally so it faces the other way."""
    return Kat(
        name=f"{kat.name}:flip",
        description=kat.description,
        grid=[list(reversed(row)) for row in kat.grid],
    )


def resolve_kat_spec(spec: str) -> Kat:
    """Resolve `name`, `name:flip`, `random`, or a path to a .kat file."""
    if Path(spec).is_file():
        return load_kat(spec)

    name, *modifiers = spec.split(":")
    if name == "random":
        kats = available_kats()
        if not kats:
            raise OctokittiError(f"no kats found in {KAT_DIR}")
        kat = random.choice(kats)
    else:
        kat = load_kat(name)

    for modifier in modifiers:
        if modifier not in MODIFIERS:
            raise OctokittiError(
                f"unknown modifier {modifier!r} in {spec!r} "
                f"(supported: {', '.join(MODIFIERS)})"
            )
        kat = flip_kat(kat)
    return kat


def compose(kats: list[Kat], gap: int = 1) -> list[list[int]]:
    """Stitch kats side by side with `gap` blank columns between them."""
    if not kats:
        raise OctokittiError("no kats to compose")
    grid: list[list[int]] = [[] for _ in range(ROWS)]
    for index, kat in enumerate(kats):
        if index:
            for row in grid:
                row.extend([0] * gap)
        for row_index in range(ROWS):
            grid[row_index].extend(kat.grid[row_index])
    return grid


# --------------------------------------------------------------------------
# Calendar maths
# --------------------------------------------------------------------------


def sunday_of(date: dt.date) -> dt.date:
    """The Sunday that starts `date`'s contribution-graph column."""
    return date - dt.timedelta(days=(date.weekday() + 1) % 7)


def default_start(width: int, today: dt.date) -> dt.date:
    """Right-align the art so it ends on the last fully elapsed week."""
    return sunday_of(today) - dt.timedelta(weeks=width)


def cell_date(start: dt.date, row: int, col: int) -> dt.date:
    return start + dt.timedelta(weeks=col, days=row)


@dataclass
class Cell:
    row: int
    col: int
    level: int
    date: dt.date
    commits: int


def plan_cells(grid: list[list[int]], start: dt.date, multiplier: int) -> list[Cell]:
    """Every lit pixel, in chronological order."""
    cells = []
    for col in range(len(grid[0])):
        for row in range(ROWS):
            level = grid[row][col]
            if level:
                cells.append(
                    Cell(
                        row=row,
                        col=col,
                        level=level,
                        date=cell_date(start, row, col),
                        commits=level * multiplier,
                    )
                )
    return cells


def warn_about_dates(cells: list[Cell], today: dt.date) -> list[str]:
    warnings = []
    if not cells:
        return warnings
    first = min(c.date for c in cells)
    last = max(c.date for c in cells)
    if last > today:
        warnings.append(
            f"art runs to {last} which is in the future - GitHub hides future commits"
        )
    if (today - first).days > 365:
        warnings.append(
            f"art starts {first}, more than a year back - the graph only shows ~53 weeks"
        )
    return warnings


def warn_about_width(width: int) -> list[str]:
    if width > GRAPH_WEEKS:
        return [
            f"art is {width} weeks wide but the graph only shows ~{GRAPH_WEEKS} "
            "- the left edge will be cut off"
        ]
    return []


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------


def render(
    grid: list[list[int]],
    start: dt.date | None = None,
    color: bool = True,
    ascii_only: bool = False,
) -> str:
    palette = ASCII_BLOCKS if ascii_only else BLOCKS
    width = len(grid[0])
    lines = []

    if start is not None:
        header = [" " * 5]
        last_month = None
        col = 0
        while col < width:
            month = cell_date(start, 0, col).strftime("%b")
            if month != last_month:
                header.append(month[:2])
                last_month = month
            else:
                header.append("  ")
            col += 1
        lines.append("".join(header))

    for row in range(ROWS):
        parts = [f"{DAY_LABELS[row]:<5}"]
        for col in range(width):
            level = grid[row][col]
            block = palette[level]
            if color and not ascii_only:
                block = f"{ANSI_RAMP[level]}{block}{ANSI_RESET}"
            parts.append(block)
        lines.append("".join(parts))
    return "\n".join(lines)


def supports_color(stream) -> bool:
    if os.environ.get("NO_COLOR"):
        return False
    return hasattr(stream, "isatty") and stream.isatty()


# --------------------------------------------------------------------------
# Animation
# --------------------------------------------------------------------------

ANIM_MODES = ("fill", "blink", "parade")
CURSOR_HIDE = "\033[?25l"
CURSOR_SHOW = "\033[?25h"
CLEAR_LINE = "\033[K"


def pad_to_width(grid: list[list[int]], width: int) -> list[list[int]]:
    """Centre a grid in `width` columns, cropping if it is already wider."""
    current = len(grid[0])
    if current >= width:
        return [row[:width] for row in grid]
    left = (width - current) // 2
    right = width - current - left
    return [[0] * left + list(row) + [0] * right for row in grid]


def reveal_frames(grid: list[list[int]], label: str, hold: int = 8) -> list:
    """Paint the art on week by week, the way `paint` actually commits it."""
    width = len(grid[0])
    frames = []
    for cols in range(width + 1):
        revealed = [
            [value if index < cols else 0 for index, value in enumerate(row)]
            for row in grid
        ]
        frames.append((revealed, f"{label}  week {cols}/{width}"))
    frames.extend([(grid, f"{label}  week {width}/{width}")] * hold)
    return frames


def blink_frames(grid: list[list[int]], label: str, open_hold: int = 12) -> list:
    """Eyes are the level-1 pixels, so darkening them to body shade is a blink."""
    shut = [[MAX_LEVEL if value == 1 else value for value in row] for row in grid]
    caption_open = f"{label}  *blink*"
    return (
        [(grid, label)] * open_hold
        + [(shut, caption_open)] * 2
        + [(grid, label)] * 4
        + [(shut, caption_open)] * 2
    )


def parade_frames(kats: list[Kat], hold: int = 12) -> list:
    """One kat at a time, centred, like a little cat show."""
    width = max(kat.width for kat in kats)
    frames = []
    for kat in kats:
        caption = f"{kat.name}  -  {kat.description}"
        frames.extend([(pad_to_width(kat.grid, width), caption)] * hold)
    return frames


def terminal_columns(stream=sys.stdout) -> int:
    try:
        return shutil.get_terminal_size().columns
    except OSError:
        return 80


def fit_to_terminal(grid: list[list[int]], columns: int) -> tuple[list[list[int]], bool]:
    """Crop the art so a frame never wraps - wrapping corrupts the redraw."""
    usable = max(1, (columns - 6) // 2)
    if len(grid[0]) <= usable:
        return grid, False
    return [row[:usable] for row in grid], True


def play(frames, fps: float, loops: int, color: bool, ascii_only: bool,
         stream=sys.stdout) -> None:
    """Redraw frames in place. Non-interactive streams just get the last one."""
    if not (hasattr(stream, "isatty") and stream.isatty()):
        grid, caption = frames[-1]
        stream.write(render(grid, color=False, ascii_only=ascii_only) + "\n")
        stream.write(caption + "\n")
        return

    height = ROWS + 1
    delay = 1.0 / fps
    stream.write(CURSOR_HIDE)
    first = True
    try:
        loop = 0
        while loops == 0 or loop < loops:
            for grid, caption in frames:
                if not first:
                    stream.write(f"\033[{height}A")
                first = False
                for line in render(grid, color=color, ascii_only=ascii_only).splitlines():
                    stream.write(f"{line}{CLEAR_LINE}\n")
                stream.write(f"{caption}{CLEAR_LINE}\n")
                stream.flush()
                time.sleep(delay)
            loop += 1
    except KeyboardInterrupt:
        pass
    finally:
        stream.write(CURSOR_SHOW)
        stream.flush()


# --------------------------------------------------------------------------
# Git plumbing
# --------------------------------------------------------------------------


def git(repo: Path, *args: str, env: dict[str, str] | None = None) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        env=env,
    )
    if result.returncode != 0:
        raise OctokittiError(
            f"git {' '.join(args)} failed: {result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout.strip()


def ensure_repo(repo: Path) -> Path:
    if not repo.is_dir():
        raise OctokittiError(f"{repo} is not a directory")
    try:
        return Path(git(repo, "rev-parse", "--absolute-git-dir"))
    except OctokittiError as exc:
        raise OctokittiError(f"{repo} is not a git repository") from exc


def current_head(repo: Path) -> str | None:
    try:
        return git(repo, "rev-parse", "HEAD")
    except OctokittiError:
        return None  # unborn branch


def commit_date(date: dt.date) -> str:
    """Noon UTC keeps the commit on the intended day for every viewer."""
    return f"{date.isoformat()}T12:00:00+00:00"


def paint(
    repo: Path,
    cells: list[Cell],
    label: str,
    progress_stream=sys.stderr,
) -> int:
    git_dir = ensure_repo(repo)
    head = current_head(repo)
    if head is None:
        raise OctokittiError(
            "repository has no commits yet - make an initial commit before painting"
        )
    if git(repo, "status", "--porcelain"):
        raise OctokittiError("working tree is dirty - commit or stash first")

    total = sum(cell.commits for cell in cells)
    done = 0
    for cell in cells:
        stamp = commit_date(cell.date)
        env = dict(os.environ, GIT_AUTHOR_DATE=stamp, GIT_COMMITTER_DATE=stamp)
        for nth in range(cell.commits):
            message = (
                f"octokitti: {label} pixel ({cell.col},{cell.row}) "
                f"level {cell.level} #{nth + 1}\n\n{TRAILER}: {label}\n"
            )
            git(repo, "commit", "--allow-empty", "-m", message, env=env)
            done += 1
            if progress_stream is not None and done % 10 == 0:
                progress_stream.write(f"\r  painting... {done}/{total} commits")
                progress_stream.flush()

    if progress_stream is not None:
        progress_stream.write(f"\r  painting... {done}/{total} commits\n")
        progress_stream.flush()

    state = {
        "head": head,
        "label": label,
        "commits": total,
        "painted_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    (git_dir / STATE_FILE).write_text(json.dumps(state, indent=2), encoding="utf-8")
    return total


def undo(repo: Path, force: bool = False) -> int:
    git_dir = ensure_repo(repo)
    state_path = git_dir / STATE_FILE
    if not state_path.is_file():
        raise OctokittiError("no octokitti paint recorded for this repository")

    state = json.loads(state_path.read_text(encoding="utf-8"))
    base = state["head"]

    revs = [r for r in git(repo, "rev-list", f"{base}..HEAD").splitlines() if r]
    if not revs:
        state_path.unlink()
        return 0

    if not force:
        for rev in revs:
            body = git(repo, "log", "-1", "--format=%B", rev)
            if TRAILER not in body:
                raise OctokittiError(
                    f"commit {rev[:8]} was not painted by octokitti - "
                    "refusing to reset (use --force to override)"
                )
    if git(repo, "status", "--porcelain"):
        raise OctokittiError("working tree is dirty - commit or stash first")

    git(repo, "reset", "--hard", base)
    state_path.unlink()
    return len(revs)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def parse_date(value: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD, got {value!r}") from exc


def resolve_grid(specs: list[str], gap: int, repeat: int = 1) -> tuple[list[list[int]], str]:
    kats = [resolve_kat_spec(spec) for spec in specs]
    label = "+".join(k.name for k in kats)
    if repeat > 1:
        kats = kats * repeat
        label = f"{label} x{repeat}"
    return compose(kats, gap=gap), label


def resolve_start(args, width: int, today: dt.date) -> tuple[dt.date, str | None]:
    if args.start is None:
        return default_start(width, today), None
    aligned = sunday_of(args.start)
    note = None
    if aligned != args.start:
        note = f"start date {args.start} snapped back to Sunday {aligned}"
    return aligned, note


def cmd_list(args) -> int:
    kats = available_kats()
    if not kats:
        print(f"no kats found in {KAT_DIR}")
        return 1
    color = supports_color(sys.stdout) and not args.ascii
    for kat in kats:
        print(f"\n{kat.name}  ({kat.width} weeks wide)")
        if kat.description:
            print(f"  {kat.description}")
        print(render(kat.grid, color=color, ascii_only=args.ascii))
    print()
    return 0


def cmd_preview(args) -> int:
    grid, label = resolve_grid(args.kats, args.gap, args.repeat)
    today = dt.date.today()
    start, note = resolve_start(args, len(grid[0]), today)
    cells = plan_cells(grid, start, args.multiplier)

    print(f"\n{label} - {len(grid[0])} weeks, {sum(c.commits for c in cells)} commits")
    print(f"starting Sunday {start}, ending {cell_date(start, 6, len(grid[0]) - 1)}\n")
    if note:
        print(f"note: {note}\n")
    print(render(grid, start=start, color=supports_color(sys.stdout) and not args.ascii,
                 ascii_only=args.ascii))
    print()
    for warning in warn_about_width(len(grid[0])) + warn_about_dates(cells, today):
        print(f"warning: {warning}")
    return 0


def cmd_paint(args) -> int:
    grid, label = resolve_grid(args.kats, args.gap, args.repeat)
    today = dt.date.today()
    start, note = resolve_start(args, len(grid[0]), today)
    cells = plan_cells(grid, start, args.multiplier)
    total = sum(c.commits for c in cells)
    repo = Path(args.repo).resolve()

    print(render(grid, start=start, color=supports_color(sys.stdout) and not args.ascii,
                 ascii_only=args.ascii))
    print()
    if note:
        print(f"note: {note}")
    for warning in warn_about_width(len(grid[0])) + warn_about_dates(cells, today):
        print(f"warning: {warning}")

    print(f"\nrepo:    {repo}")
    print(f"kat:     {label}")
    print(f"commits: {total} empty commits across {len(cells)} days")
    print(f"dates:   {start} -> {cell_date(start, 6, len(grid[0]) - 1)}")

    if not args.yes:
        print("\nThis was a dry run. Re-run with --yes to actually paint.")
        return 0

    ensure_repo(repo)
    print()
    painted = paint(repo, cells, label)
    print(f"\npainted {painted} commits. Push the branch to see your kat.")
    print(f"undo with: python3 {Path(__file__).name} undo --repo {repo}")
    return 0


def cmd_undo(args) -> int:
    repo = Path(args.repo).resolve()
    if not args.yes:
        git_dir = ensure_repo(repo)
        state_path = git_dir / STATE_FILE
        if not state_path.is_file():
            raise OctokittiError("no octokitti paint recorded for this repository")
        state = json.loads(state_path.read_text(encoding="utf-8"))
        print(f"would reset {repo} to {state['head'][:8]}, "
              f"dropping {state['commits']} commits painted as {state['label']}")
        print("Re-run with --yes to actually undo.")
        return 0
    removed = undo(repo, force=args.force)
    print(f"removed {removed} commits. Your graph is a blank canvas again.")
    return 0


def cmd_animate(args) -> int:
    specs = args.kats or [kat.name for kat in available_kats()]
    if not specs:
        raise OctokittiError(f"no kats found in {KAT_DIR}")

    mode = args.mode or ("fill" if args.kats else "parade")
    kats = [resolve_kat_spec(spec) for spec in specs]
    color = supports_color(sys.stdout) and not args.ascii

    if mode == "parade":
        frames = parade_frames(kats, hold=max(1, round(args.fps)))
    else:
        label = "+".join(kat.name for kat in kats)
        grid, cropped = fit_to_terminal(
            compose(kats, gap=args.gap), terminal_columns()
        )
        if cropped:
            print(f"note: terminal is narrow, showing the first {len(grid[0])} weeks")
        frames = (
            reveal_frames(grid, label) if mode == "fill" else blink_frames(grid, label)
        )

    play(frames, fps=args.fps, loops=args.loops, color=color, ascii_only=args.ascii)
    return 0


class KatParser(argparse.ArgumentParser):
    """argparse, but it explains the mistakes people actually make."""

    HINTS = {
        "--yes": "only `paint` and `undo` take --yes; `preview` and `animate` "
                 "never touch git, so there is nothing to confirm",
        "--repo": "only `paint` and `undo` take --repo; `preview` and `animate` "
                  "just render to the terminal",
        "--multiplier": "--multiplier only applies to `paint` and `preview`",
        "--mode": "--mode only applies to `animate`",
    }

    def error(self, message: str) -> None:
        for flag, hint in self.HINTS.items():
            if flag in message:
                message = f"{message}\nhint: {hint}"
                break
        super().error(message)


def build_parser() -> argparse.ArgumentParser:
    parser = KatParser(
        prog="octokitti",
        description="gitfiti, but the only palette is octocats",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_art_args(sub):
        sub.add_argument("kats", nargs="+",
                         help="kat names, 'random', 'name:flip', or paths to .kat files")
        sub.add_argument("--start", type=parse_date, metavar="YYYY-MM-DD",
                         help="first Sunday of the art (default: right-aligned to today)")
        sub.add_argument("--multiplier", type=int, default=1,
                         help="commits per shade level (default: 1)")
        sub.add_argument("--gap", type=int, default=1,
                         help="blank columns between kats (default: 1)")
        sub.add_argument("--repeat", type=int, default=1,
                         help="repeat the whole composition N times (default: 1)")
        sub.add_argument("--ascii", action="store_true", help="plain ASCII output")

    list_parser = subparsers.add_parser("list", help="show the available kats")
    list_parser.add_argument("--ascii", action="store_true", help="plain ASCII output")
    list_parser.set_defaults(func=cmd_list)

    preview_parser = subparsers.add_parser("preview", help="render art without touching git")
    add_art_args(preview_parser)
    preview_parser.set_defaults(func=cmd_preview)

    paint_parser = subparsers.add_parser("paint", help="create the backdated commits")
    add_art_args(paint_parser)
    paint_parser.add_argument("--repo", required=True,
                              help="path to a throwaway repo to paint in")
    paint_parser.add_argument("--yes", action="store_true",
                              help="actually commit (otherwise dry run)")
    paint_parser.set_defaults(func=cmd_paint)

    animate_parser = subparsers.add_parser(
        "animate", help="play the art in the terminal")
    animate_parser.add_argument(
        "kats", nargs="*",
        help="kat specs (default: the whole litter, as a parade)")
    animate_parser.add_argument(
        "--mode", choices=ANIM_MODES, default=None,
        help="fill: reveal week by week; blink: eyes blink; parade: one at a time "
             "(default: fill, or parade when no kats are named)")
    animate_parser.add_argument("--fps", type=float, default=12.0,
                                help="frames per second (default: 12)")
    animate_parser.add_argument("--loops", type=int, default=3,
                                help="times to repeat, 0 for forever (default: 3)")
    animate_parser.add_argument("--gap", type=int, default=1,
                                help="blank columns between kats (default: 1)")
    animate_parser.add_argument("--ascii", action="store_true",
                                help="plain ASCII output")
    animate_parser.set_defaults(func=cmd_animate)

    undo_parser = subparsers.add_parser("undo", help="remove the last painted commits")
    undo_parser.add_argument("--repo", required=True, help="path to the painted repo")
    undo_parser.add_argument("--yes", action="store_true", help="actually reset")
    undo_parser.add_argument("--force", action="store_true",
                             help="reset even if unrelated commits are on top")
    undo_parser.set_defaults(func=cmd_undo)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if getattr(args, "multiplier", 1) < 1:
        print("error: --multiplier must be at least 1", file=sys.stderr)
        return 2
    if getattr(args, "gap", 0) < 0:
        print("error: --gap cannot be negative", file=sys.stderr)
        return 2
    if getattr(args, "repeat", 1) < 1:
        print("error: --repeat must be at least 1", file=sys.stderr)
        return 2
    if getattr(args, "fps", 1) <= 0:
        print("error: --fps must be greater than zero", file=sys.stderr)
        return 2
    if getattr(args, "loops", 0) < 0:
        print("error: --loops cannot be negative", file=sys.stderr)
        return 2
    try:
        return args.func(args)
    except OctokittiError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
