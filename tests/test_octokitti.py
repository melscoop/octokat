"""Tests for octokitti. Run with: python3 -m unittest discover tests"""

import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import octokitti as ok  # noqa: E402


SAMPLE = """\
# name: sample
# desc: a tiny test kat
.4.
4.4
.4.
4.4
.4.
4.4
.44
"""


class ParseKatTests(unittest.TestCase):
    def test_parses_headers_and_grid(self):
        kat = ok.parse_kat(SAMPLE, "sample")
        self.assertEqual(kat.description, "a tiny test kat")
        self.assertEqual(kat.width, 3)
        self.assertEqual(kat.grid[0], [0, 4, 0])
        self.assertEqual(kat.grid[6], [0, 4, 4])

    def test_dots_zeros_and_spaces_are_all_blank(self):
        kat = ok.parse_kat("...\n000\n   4\n...\n...\n...\n...\n", "blanks")
        self.assertEqual(kat.grid[0], [0, 0, 0, 0])
        self.assertEqual(kat.grid[1], [0, 0, 0, 0])
        self.assertEqual(kat.grid[2], [0, 0, 0, 4])

    def test_short_rows_are_padded(self):
        kat = ok.parse_kat("4444\n4\n4\n4\n4\n4\n4\n", "ragged")
        self.assertEqual(kat.width, 4)
        self.assertTrue(all(len(row) == 4 for row in kat.grid))

    def test_rejects_wrong_row_count(self):
        with self.assertRaises(ok.OctokittiError):
            ok.parse_kat("4\n4\n4\n", "short")

    def test_rejects_unknown_character(self):
        with self.assertRaises(ok.OctokittiError):
            ok.parse_kat("4\n4\n4\n4\n4\n4\n9\n", "loud")

    def test_rejects_unknown_name(self):
        with self.assertRaises(ok.OctokittiError):
            ok.load_kat("definitely-not-a-kat")


class BundledKatTests(unittest.TestCase):
    def test_every_bundled_kat_is_valid(self):
        kats = ok.available_kats()
        self.assertGreater(len(kats), 0, "no kats shipped")
        for kat in kats:
            with self.subTest(kat=kat.name):
                self.assertEqual(len(kat.grid), ok.ROWS)
                self.assertTrue(all(len(r) == kat.width for r in kat.grid))
                self.assertTrue(kat.description, "kat needs a description")
                self.assertLessEqual(kat.width, ok.GRAPH_WEEKS)
                self.assertTrue(any(any(row) for row in kat.grid), "kat is blank")


class SpecTests(unittest.TestCase):
    def test_flip_mirrors_horizontally(self):
        kat = ok.parse_kat("41.\n...\n...\n...\n...\n...\n...\n", "arrow")
        self.assertEqual(ok.flip_kat(kat).grid[0], [0, 1, 4])

    def test_flip_twice_is_identity(self):
        kat = ok.parse_kat(SAMPLE, "sample")
        self.assertEqual(ok.flip_kat(ok.flip_kat(kat)).grid, kat.grid)

    def test_flip_records_itself_in_the_name(self):
        self.assertEqual(ok.resolve_kat_spec("octoface:flip").name, "octoface:flip")

    def test_spec_resolves_plain_name(self):
        self.assertEqual(ok.resolve_kat_spec("octoface").name, "octoface")

    def test_spec_flip_matches_manual_flip(self):
        self.assertEqual(
            ok.resolve_kat_spec("octoface:flip").grid,
            ok.flip_kat(ok.load_kat("octoface")).grid,
        )

    def test_random_picks_a_bundled_kat(self):
        names = {k.name for k in ok.available_kats()}
        self.assertIn(ok.resolve_kat_spec("random").name, names)

    def test_rejects_unknown_modifier(self):
        with self.assertRaises(ok.OctokittiError):
            ok.resolve_kat_spec("octoface:spin")


class ResolveGridTests(unittest.TestCase):
    def test_repeat_multiplies_width_and_labels(self):
        single, label = ok.resolve_grid(["kitten"], gap=1, repeat=1)
        tripled, tripled_label = ok.resolve_grid(["kitten"], gap=1, repeat=3)
        self.assertEqual(len(tripled[0]), len(single[0]) * 3 + 2)
        self.assertEqual(label, "kitten")
        self.assertEqual(tripled_label, "kitten x3")

    def test_label_joins_multiple_kats(self):
        _, label = ok.resolve_grid(["kitten", "heart:flip"], gap=1)
        self.assertEqual(label, "kitten+heart:flip")


class ComposeTests(unittest.TestCase):
    def test_gap_columns_are_inserted_between_kats(self):
        kat = ok.parse_kat(SAMPLE, "sample")
        grid = ok.compose([kat, kat], gap=2)
        self.assertEqual(len(grid[0]), 3 + 2 + 3)
        self.assertEqual(grid[0], [0, 4, 0, 0, 0, 0, 4, 0])

    def test_single_kat_is_unchanged(self):
        kat = ok.parse_kat(SAMPLE, "sample")
        self.assertEqual(ok.compose([kat]), kat.grid)

    def test_rejects_empty_list(self):
        with self.assertRaises(ok.OctokittiError):
            ok.compose([])


class CalendarTests(unittest.TestCase):
    def test_sunday_of_snaps_backwards(self):
        # 2026-09-14 is a Monday; its column starts Sunday the 13th.
        self.assertEqual(ok.sunday_of(dt.date(2026, 9, 14)), dt.date(2026, 9, 13))
        self.assertEqual(ok.sunday_of(dt.date(2026, 9, 13)), dt.date(2026, 9, 13))
        self.assertEqual(ok.sunday_of(dt.date(2026, 9, 19)), dt.date(2026, 9, 13))

    def test_default_start_is_a_sunday_in_the_past(self):
        today = dt.date(2026, 9, 14)
        start = ok.default_start(9, today)
        self.assertEqual(ok.sunday_of(start), start)
        self.assertLess(ok.cell_date(start, 6, 8), today)

    def test_default_start_leaves_no_future_dates(self):
        today = dt.date(2026, 9, 14)
        for width in range(1, 20):
            with self.subTest(width=width):
                last = ok.cell_date(ok.default_start(width, today), 6, width - 1)
                self.assertLess(last, today)

    def test_cell_date_maps_rows_to_weekdays(self):
        start = dt.date(2026, 9, 6)  # a Sunday
        self.assertEqual(ok.cell_date(start, 0, 0), start)
        self.assertEqual(ok.cell_date(start, 6, 0), dt.date(2026, 9, 12))
        self.assertEqual(ok.cell_date(start, 0, 2), dt.date(2026, 9, 20))


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.kat = ok.parse_kat(SAMPLE, "sample")
        self.start = dt.date(2026, 9, 6)

    def test_only_lit_pixels_are_planned(self):
        cells = ok.plan_cells(self.kat.grid, self.start, 1)
        lit = sum(1 for row in self.kat.grid for value in row if value)
        self.assertEqual(len(cells), lit)

    def test_multiplier_scales_commit_counts(self):
        one = sum(c.commits for c in ok.plan_cells(self.kat.grid, self.start, 1))
        three = sum(c.commits for c in ok.plan_cells(self.kat.grid, self.start, 3))
        self.assertEqual(three, one * 3)

    def test_cells_are_chronological(self):
        cells = ok.plan_cells(self.kat.grid, self.start, 1)
        self.assertEqual([c.date for c in cells], sorted(c.date for c in cells))

    def test_commits_match_shade_level(self):
        grid = [[0] * 3 for _ in range(ok.ROWS)]
        grid[2][1] = 4
        cell = ok.plan_cells(grid, self.start, 2)[0]
        self.assertEqual(cell.commits, 8)
        self.assertEqual(cell.date, dt.date(2026, 9, 15))


class WarningTests(unittest.TestCase):
    def setUp(self):
        self.grid = [[4] * 2 for _ in range(ok.ROWS)]

    def test_warns_about_future_dates(self):
        today = dt.date(2026, 9, 14)
        cells = ok.plan_cells(self.grid, dt.date(2026, 10, 4), 1)
        self.assertTrue(any("future" in w for w in ok.warn_about_dates(cells, today)))

    def test_warns_about_ancient_dates(self):
        today = dt.date(2026, 9, 14)
        cells = ok.plan_cells(self.grid, dt.date(2024, 1, 7), 1)
        self.assertTrue(any("year back" in w for w in ok.warn_about_dates(cells, today)))

    def test_quiet_when_dates_are_sensible(self):
        today = dt.date(2026, 9, 14)
        cells = ok.plan_cells(self.grid, ok.default_start(2, today), 1)
        self.assertEqual(ok.warn_about_dates(cells, today), [])

    def test_warns_when_art_is_wider_than_the_graph(self):
        self.assertTrue(ok.warn_about_width(ok.GRAPH_WEEKS + 1))
        self.assertEqual(ok.warn_about_width(ok.GRAPH_WEEKS), [])


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.kat = ok.parse_kat(SAMPLE, "sample")

    def test_renders_one_line_per_weekday(self):
        lines = ok.render(self.kat.grid, color=False).splitlines()
        self.assertEqual(len(lines), ok.ROWS)
        self.assertTrue(lines[0].startswith("Sun"))
        self.assertTrue(lines[6].startswith("Sat"))

    def test_start_date_adds_a_month_header(self):
        lines = ok.render(self.kat.grid, start=dt.date(2026, 9, 6), color=False).splitlines()
        self.assertEqual(len(lines), ok.ROWS + 1)
        self.assertIn("Se", lines[0])

    def test_ascii_mode_emits_no_escape_codes(self):
        out = ok.render(self.kat.grid, color=True, ascii_only=True)
        self.assertNotIn("\033", out)

    def test_color_mode_emits_escape_codes(self):
        self.assertIn("\033", ok.render(self.kat.grid, color=True))


class CommitDateTests(unittest.TestCase):
    def test_uses_noon_utc(self):
        self.assertEqual(ok.commit_date(dt.date(2026, 9, 14)), "2026-09-14T12:00:00+00:00")


class CliTests(unittest.TestCase):
    def test_rejects_zero_multiplier(self):
        self.assertEqual(ok.main(["preview", "octoface", "--multiplier", "0"]), 2)

    def test_rejects_negative_gap(self):
        self.assertEqual(ok.main(["preview", "octoface", "--gap", "-1"]), 2)

    def test_rejects_zero_repeat(self):
        self.assertEqual(ok.main(["preview", "octoface", "--repeat", "0"]), 2)

    def test_reports_unknown_modifier_as_an_error(self):
        self.assertEqual(ok.main(["preview", "octoface:spin", "--ascii"]), 1)

    def test_rejects_bad_date(self):
        with self.assertRaises(SystemExit):
            ok.main(["preview", "octoface", "--start", "not-a-date"])

    def test_paint_without_yes_is_a_dry_run(self):
        self.assertEqual(
            ok.main(["paint", "octoface", "--repo", str(Path(__file__).parent), "--ascii"]),
            0,
        )


if __name__ == "__main__":
    unittest.main()
