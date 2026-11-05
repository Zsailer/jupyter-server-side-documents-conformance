import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "compliance"))
sys.path.insert(0, str(ROOT / "tools"))

import generate as g  # noqa: E402
import nbscenario_spec as spec  # noqa: E402


def cells(*tokens):
    return g.model(list(tokens), {}, [])


class OpsTest(unittest.TestCase):
    def test_a_moved_cell_is_the_one_that_moves(self):
        # "the first tab moves c1 to the end": c1 moves; the cells around it do not
        ops = g.ops_for(cells("c0", "c1", "c2"), cells("c0", "c2", "^c1"))
        self.assertEqual(ops, [("move", 1, 2)])

    def test_moving_the_first_cell_to_the_end(self):
        self.assertEqual(g.ops_for(cells("c0", "c1", "c2"), cells("c1", "c2", "^c0")), [("move", 0, 2)])

    def test_typing_at_the_end_of_a_cell(self):
        ops = g.ops_for(cells("c0", "c1", "c2"), cells("c0", "c1=+OFFLINE", "c2"))
        self.assertEqual(ops, [("type", 1, " +OFFLINE")])

    def test_more_typing_is_only_the_new_piece(self):
        ops = g.ops_for(cells("c0=+A"), cells("c0=+A +B"))
        self.assertEqual(ops, [("type", 0, " +B")])

    def test_adding_a_cell_types_it_whole_where_it_goes(self):
        self.assertEqual(g.ops_for(cells("c0", "c1"), cells("c0", "c1", "+NEW-B")), [("add", 2, "NEW-B")])
        self.assertEqual(g.ops_for(cells("c0", "c1"), cells("+NEW", "c0", "c1")), [("add", 0, "NEW")])

    def test_deleting_a_cell(self):
        self.assertEqual(g.ops_for(cells("c0", "c1", "c2"), cells("c0", "-c1", "c2")), [("delete", 1)])

    def test_rewriting_a_cell(self):
        ops = g.ops_for(cells("c0", "c1"), cells("c0=total = a - b", "c1"))
        self.assertEqual(ops, [("rewrite", 0, "total = a - b")])

    def test_no_change_no_edit(self):
        self.assertEqual(g.ops_for(cells("c0", "c1"), cells("c0", "c1")), [])

    def test_an_edit_and_an_add_in_one_step(self):
        ops = g.ops_for(cells("c0", "c1", "c2"), cells("c0=+TYPED", "c1", "c2", "+ONLINE CELL"))
        self.assertEqual(ops, [("type", 0, " +TYPED"), ("add", 3, "ONLINE CELL")])


class ExpectTest(unittest.TestCase):
    def test_a_plain_cell_reads_as_its_name(self):
        self.assertEqual(g.make_cell("c0", {}, []).expect, ("exact", "c0"))

    def test_typed_text_follows_the_cell_after_a_space(self):
        self.assertEqual(g.make_cell("c1=+B-TYPED", {}, []).expect, ("exact", "c1 +B-TYPED"))

    def test_typing_from_two_people_may_land_in_either_order(self):
        self.assertEqual(g.make_cell("c1=+A-OFFLINE +B-ONLINE", {}, []).expect, ("parts", "c1", ["+A-OFFLINE", "+B-ONLINE"]))

    def test_a_rewrite_reads_as_what_it_was_rewritten_as(self):
        self.assertEqual(g.make_cell("c2=EXTERNAL EDIT", {}, []).expect, ("exact", "EXTERNAL EDIT"))
        self.assertEqual(g.make_cell("c0=total = a - b", {}, []).expect, ("exact", "total = a - b"))

    def test_a_recovered_copy_is_found_by_what_it_holds(self):
        self.assertEqual(g.make_cell("?c1 +OFFLINE=recovered", {}, []).expect, ("contains", ["c1", "+OFFLINE"]))

    def test_what_must_not_happen_is_not_a_cell_to_find(self):
        self.assertIsNone(g.make_cell("!c0=twice", {}, []).expect)
        self.assertIsNone(g.make_cell("-c1", {}, []).expect)
        self.assertIsNone(g.make_cell("*a remark", {}, []))

    def test_an_annotation_does_not_change_the_cell(self):
        self.assertEqual(g.make_cell("c0=1 output", {}, []).expect, ("exact", "c0"))
        self.assertEqual(g.make_cell("+x9=ADDED ON DISK", {}, []).expect, ("exact", "x9"))

    def test_a_note_nothing_can_be_checked_from_is_said_so(self):
        loose = []
        g.make_cell("c0=something only a person understands", {}, loose)
        self.assertEqual(len(loose), 1)
        loose = []
        g.make_cell("c0=something only a person understands", {"c0=something only a person understands": {"contains": ["x"]}}, loose)
        self.assertEqual(loose, [], "the oracle says what it means")


class GeneratedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = g.generate()
        cls.manifest = {m["id"]: m for m in cls.result["manifest"]}

    def test_every_story_has_a_test(self):
        self.assertGreaterEqual(len(self.manifest), 60)
        text = "\n".join(self.result["files"].values())
        for sid in self.manifest:
            self.assertRegex(text, r'"id": "%s"' % re.escape(sid))

    def test_what_a_story_needs_follows_from_its_steps(self):
        need = lambda sid: set(self.manifest[sid]["requires"])
        self.assertEqual(need("Z3"), set(), "people typing, deleting and going offline: any JupyterLab")
        self.assertEqual(need("A"), {"releaseRoom"}, "the server lets go of the notebook")
        self.assertIn("crashServer", need("S2"))
        self.assertIn("fileSystem", need("Z5"), "the file is changed from outside")
        self.assertIn("agent", need("AI1"))
        self.assertIn("historyRecord", need("S12"))
        self.assertIn("wireFaults", need("B"), "a message is lost")

    def test_the_stories_that_ask_a_question_are_marked(self):
        self.assertTrue(self.manifest["Z3"]["needsAlignment"])
        self.assertFalse(self.manifest["A"]["needsAlignment"])

    def test_the_first_person_to_move_a_cell_does_so_in_z1(self):
        text = self.result["files"]["residual.spec.ts"]
        self.assertIn("await tab.moveCell(1, 2);", text, "c1 goes to the end, as the story says")

    def test_a_decision_gives_its_endings_proposed_first_each_with_its_name(self):
        text = self.result["files"]["residual.spec.ts"]
        z3 = text[text.index('"id": "Z3"'):text.index('"id": "Z4"')]
        ends = z3[z3.index("await s.ends(["):]
        # proposed: the deletion wins; the alternative: the typing comes back as a recovered copy
        self.assertLess(ends.index('label: "The deletion wins"'), ends.index('label: "The typing is kept as a recovered copy"'))
        self.assertLess(ends.index('"c0", "c2"'), ends.index("E.contains"))

    def test_an_alternative_expects_what_the_proposed_answer_rules_out(self):
        # Z2: the proposed answer has the cell once; "the merge decides" is the cell twice, which the page marks "!"
        text = self.result["files"]["residual.spec.ts"]
        z2 = text[text.index('"id": "Z2"'):text.index('"id": "Z3"')]
        proposed, alternative = z2.split('label: "The merge decides"')
        self.assertIn('label: "The cell exists once"', proposed)
        self.assertNotIn('"c1", "c0", "c0", "c2"', proposed)
        self.assertIn('"c1", "c0", "c0", "c2"', alternative)

    def test_a_story_that_is_not_a_question_has_one_ending(self):
        text = self.result["files"]["rebuild.spec.ts"]
        self.assertIn('label: "As the story ends"', text)

    def test_the_committed_files_are_what_the_storyboards_give(self):
        self.assertEqual(g.write(self.result, check=True), [], "run: python3 -I compliance/generate.py")

    def test_no_generated_test_leaks_a_python_artifact(self):
        for name, text in self.result["files"].items():
            self.assertNotRegex(text, r"\bNone\b|\bTrue\b|\bFalse\b|<Cell|\(\'", name)

    def test_the_coverage_report_counts_every_story(self):
        report = g.coverage(self.result["manifest"], self.result["groups"])
        self.assertIn(f"{len(self.manifest)} stories", report)


if __name__ == "__main__":
    unittest.main()
