import json
import re
import sys
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "compliance"))
sys.path.insert(0, str(ROOT / "tools"))

import yaml
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


def story_text(text, sid):
    """The generated test of one story: from its id to the next story's."""
    start = text.index('"id": "%s"' % sid)
    nxt = text.find('"id": "', start + 1)
    return text[start : nxt if nxt != -1 else len(text)]


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
        self.assertEqual(need("conflict/delete-while-typing"), set(), "people typing, deleting and going offline: any JupyterLab")
        self.assertEqual(need("handshake/reconnect-after-rebuild-control"), {"releaseRoom"}, "the server lets go of the notebook")
        self.assertIn("crashServer", need("crash/dies-before-save"))
        self.assertIn("fileSystem", need("files/changed-outside-while-typing"), "the file is changed from outside")
        self.assertIn("agent", need("agent/edits-open-notebook"))
        self.assertIn("historyRecord", need("history/notebook-too-big"))
        self.assertIn("wireFaults", need("handshake/answer-lost"), "a message is lost")

    def test_the_stories_that_ask_a_question_are_marked(self):
        self.assertTrue(self.manifest["conflict/delete-while-typing"]["needsAlignment"])
        self.assertFalse(self.manifest["handshake/reconnect-after-rebuild-control"]["needsAlignment"])

    def test_the_first_person_to_move_a_cell_does_so_in_the_move_while_typing_story(self):
        text = self.result["files"]["conflict.spec.ts"]
        self.assertIn("await tab.moveCell(1, 2);", text, "c1 goes to the end, as the story says")

    def test_a_decision_gives_its_endings_proposed_first_each_with_its_name(self):
        z3 = story_text(self.result["files"]["conflict.spec.ts"], "conflict/delete-while-typing")
        ends = z3[z3.index("await s.ends(["):]
        # proposed: the deletion wins; the alternative: the typing comes back as a recovered copy
        self.assertLess(ends.index('label: "The deletion wins"'), ends.index('label: "The typing is kept as a recovered copy"'))
        self.assertLess(ends.index('"c0", "c2"'), ends.index("E.contains"))

    def test_an_alternative_expects_what_the_proposed_answer_rules_out(self):
        # conflict/move-same-cell: the proposed answer has the cell once; "the merge decides" is the cell twice, which the page marks "!"
        z2 = story_text(self.result["files"]["conflict.spec.ts"], "conflict/move-same-cell")
        proposed, alternative = z2.split('label: "The merge decides"')
        self.assertIn('label: "The cell exists once"', proposed)
        self.assertNotIn('"c1", "c0", "c0", "c2"', proposed)
        self.assertIn('"c1", "c0", "c0", "c2"', alternative)

    def test_a_story_that_is_not_a_question_has_one_ending(self):
        text = self.result["files"]["rebuild.spec.ts"]
        self.assertIn('label: "As the story ends"', text)

    def test_a_collaborator_who_adds_a_cell_the_storyboard_only_names_adds_it(self):
        # offline/stale-tabs-plus-collaborator: "W adds a cell “X-1”" has no cells; without the cell in quotes nothing would ever be added
        h3 = story_text(self.result["files"]["offline.spec.ts"], "offline/stale-tabs-plus-collaborator")
        self.assertIn('await tab3.addCell(3, "X-1");', h3)
        self.assertIn('await tab3.addCell(4, "X-2");', h3)
        self.assertIn('await tab4.addCell(5, "Y-1");', h3)

    def test_a_tab_that_closes_and_later_comes_back_stays_open_offline(self):
        # offline/stale-tabs-different-amounts: "B and W close their tabs" ... "B comes back second"
        h2 = story_text(self.result["files"]["offline.spec.ts"], "offline/stale-tabs-different-amounts")
        self.assertIn("await tab2.goOffline(); // it goes away", h2)
        self.assertIn("await tab3.close();", h2, "W never comes back: it really closes")
        self.assertNotIn("await tab2.close();", h2)

    def test_stories_about_the_servers_inside_are_not_checked_from_the_outside(self):
        for sid in ("shutdown/update-waiting", "shutdown/damaged-message-first", "shutdown/waits-for-cleanup", "shutdown/update-from-left-tab"):
            self.assertTrue(self.manifest[sid]["internal"], sid)
        self.assertFalse(self.manifest["conflict/delete-while-typing"]["internal"])
        self.assertIn('"internal":', self.result["files"]["shutdown.spec.ts"])

    def test_a_server_that_has_let_go_of_the_notebook_is_not_asked_what_it_holds(self):
        # shutdown/update-from-left-tab ends after "the server is told to shut the notebook down": its copy is gone
        x4 = story_text(self.result["files"]["shutdown.spec.ts"], "shutdown/update-from-left-tab")
        self.assertNotIn("server:", x4[x4.index("await s.ends(["):])
        # crash/dies-before-save-no-tab-left ends after the server dies and starts again and a tab opens: it holds the notebook
        z6 = story_text(self.result["files"]["serial.spec.ts"], "crash/dies-before-save-no-tab-left")
        self.assertIn("server:", z6[z6.index("await s.ends(["):])

    def test_the_stories_that_kill_the_server_are_in_a_file_of_their_own_and_only_they(self):
        # they run alone, after the others (playwright.config.ts), so nothing else may be in that file
        serial = {s["id"] for s in self.result["manifest"] if "crashServer" in s["requires"]}
        self.assertTrue(serial)
        in_file = set(re.findall(r'"id": "([^"]+)"', self.result["files"]["serial.spec.ts"]))
        self.assertEqual(in_file, serial)
        for name, text in self.result["files"].items():
            if name != "serial.spec.ts":
                self.assertFalse(serial & set(re.findall(r'"id": "([^"]+)"', text)), name)

    def test_a_proposed_case_added_to_a_group_is_generated_and_marked(self):
        with tempfile.TemporaryDirectory() as d:
            copy = Path(d) / "stories"
            shutil.copytree(g.DATA, copy)
            path = copy / "storyboards" / "rebuild.yaml"
            body = yaml.safe_load(path.read_text())
            new = {
                "title": "A new case",
                "story": "Someone proposes it.",
                "status": "proposed",
                "steps": [{"at": "tab", "kind": "open", "text": "opens", "cells": ["c0"]}],
                "result": "Nothing happens.",
                "ends": {"all": ["c0"]},
            }
            body["scenarios"]["rebuild/a-new-case"] = new
            path.write_text(yaml.safe_dump(body, sort_keys=False))
            result = g.generate(copy)
        manifest = {m["id"]: m for m in result["manifest"]}
        self.assertTrue(manifest["rebuild/a-new-case"]["proposed"])
        self.assertFalse(manifest["conflict/delete-while-typing"]["proposed"])
        text = result["files"]["rebuild.spec.ts"]
        mine = story_text(text, "rebuild/a-new-case")
        self.assertIn('"proposed": true', mine[: mine.index("async s =>")])

    def test_generating_twice_gives_the_same_files(self):
        again = g.generate()
        self.assertEqual(again["files"], self.result["files"])

    def test_no_generated_test_leaks_a_python_artifact(self):
        for name, text in self.result["files"].items():
            self.assertNotRegex(text, r"\bNone\b|\bTrue\b|\bFalse\b|<Cell|\(\'", name)

    def test_the_coverage_report_counts_every_story(self):
        report = g.coverage(self.result["manifest"], self.result["groups"])
        self.assertIn(f"{len(self.manifest)} stories", report)


if __name__ == "__main__":
    unittest.main()
