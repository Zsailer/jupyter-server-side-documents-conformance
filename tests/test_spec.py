import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "examples" / "storyboards"))

import build  # noqa: E402
import nbscenario_spec as spec  # noqa: E402

DATA = ROOT / "examples" / "storyboards" / "data"


def story(**over):
    base = {
        "title": "t",
        "story": "s",
        "steps": [{"at": "tab", "kind": "open", "text": "opens", "cells": ["c0"]}],
        "result": "r",
        "ends": {"all": ["c0"]},
    }
    base.update(over)
    return base


class SpecTest(unittest.TestCase):
    def test_every_vendored_story_is_valid(self):
        src = build.load(DATA)
        self.assertGreaterEqual(len(src["stories"]), 60)
        for sid, st in src["stories"].items():
            spec.validate_story(sid, st)

    def test_a_minimal_story_is_valid(self):
        spec.validate_story("X", story())

    def test_mistakes_are_refused_with_a_message(self):
        bad = {
            "unknown key": (story(colour="red"), "unknown key"),
            "missing result": (story(result=""), "result is required"),
            "unknown kind": (story(steps=[{"at": "tab", "kind": "dance", "text": "x"}]), "not one of"),
            "unknown lane": (story(steps=[{"at": "phone", "kind": "open", "text": "x"}]), "not a lane"),
            "step key": (story(steps=[{"at": "tab", "kind": "open", "text": "x", "when": 3}]), "a step has"),
            "bad cell": (story(ends={"all": ["="]}), "not a cell"),
            "cells for the agent": (story(steps=[{"at": "ai", "kind": "type", "text": "x", "cells": ["c0"]}]), "holds no copy"),
            "undrawn lane": (story(lanes={"tab": "A"}, steps=[{"at": "server", "kind": "open", "text": "x"}]), "does not list"),
            "decision with one option": (story(decision={"question": "q", "options": [{"label": "a", "detail": "d", "proposed": True}]}), "at least two"),
            "decision with no proposal": (story(decision={"question": "q", "options": [{"label": "a", "detail": "d"}, {"label": "b", "detail": "d"}]}), "exactly one"),
        }
        for name, (st, message) in bad.items():
            with self.subTest(name):
                with self.assertRaisesRegex(spec.SpecError, message):
                    spec.validate_story("X", st)

    def test_python_and_javascript_agree_on_the_vocabulary(self):
        if not shutil.which("node"):
            self.skipTest("node is not installed")
        out = subprocess.run(
            ["node", "-e", "const N=require('./player/nbscenario.js');console.log(JSON.stringify({kinds:Object.keys(N.KINDS),lanes:N.LANES}))"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout
        js = json.loads(out)
        self.assertEqual(sorted(js["kinds"]), sorted(spec.KINDS))
        self.assertEqual(list(js["lanes"]), list(spec.LANES))
        self.assertEqual(js["lanes"], spec.LANES)


class BuildTest(unittest.TestCase):
    def test_the_page_is_deterministic_and_self_contained(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = Path(d) / "a.html", Path(d) / "b.html"
            build.build(DATA, a)
            build.build(DATA, b)
            for name in ("a.html", "b.html", "about.html"):
                self.assertTrue((Path(d) / name).exists(), name)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            pages = {"index": a.read_text(), "about": (Path(d) / "about.html").read_text()}
        for name, page in pages.items():
            with self.subTest(name):
                self.assertNotRegex(page, r"<script[^>]+src=", "no external script")
                self.assertNotRegex(page, r"<link[^>]+href=", "no external stylesheet")
                self.assertNotRegex(page, r"url\(\s*['\"]?https?:", "no external resource in the styles")
                self.assertIn("prefers-color-scheme: dark", page)
                self.assertIn('data-theme-set="dark"', page)

    def test_the_stories_page_is_light_and_the_explanation_is_on_its_own_page(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "index.html"
            build.build(DATA, out)
            index, about = out.read_text(), (Path(d) / "about.html").read_text()
        for section in ('id="picture"', 'id="how"', 'id="principles"', 'id="need"'):
            self.assertNotIn(section, index, "moved to about.html: " + section)
            self.assertIn(section, about)
        self.assertIn('href="about.html"', index, "the stories page says where the explanation is")
        self.assertIn('href="index.html#Z3"', about, "the explanation links back to the stories")
        self.assertIn('href="index.html"', about)

    def test_the_page_has_every_story_once_with_a_text_version(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "p.html"
            result = build.build(DATA, out)
            page = out.read_text()
        for sid in result["stories"]:
            self.assertEqual(len(re.findall(r'<article class="story-card[^"]*" id="%s"' % re.escape(sid), page)), 1, sid)
        self.assertGreaterEqual(page.count("<ol>"), len(result["stories"]), "each story has its steps as plain text for no-JS readers")

    def test_the_stories_that_need_alignment_are_exactly_those_with_a_decision(self):
        src = build.load(DATA)
        suite = src["suite"]["scenarios"]
        for sid, st in src["stories"].items():
            status = (suite.get(sid, {}).get("policy") or {}).get("status")
            self.assertEqual(bool(st.get("decision")), status in ("best_effort", "pending"), sid)

    def test_a_decision_is_labelled_suggested_only_when_nobody_has_discussed_it(self):
        src = build.load(DATA)
        for sid in ("AI5", "AI6", "AI7"):
            self.assertEqual(build.story_json(src, sid)["decision"]["answerLabel"], "Suggested", sid)
        self.assertEqual(build.story_json(src, "Z3")["decision"]["answerLabel"], "Proposed")

    def test_the_minimal_example_points_at_files_that_exist(self):
        html = (ROOT / "examples" / "minimal" / "index.html").read_text()
        for ref in re.findall(r'(?:src|href)="(\.\./\.\./[^"]+)"', html):
            self.assertTrue((ROOT / "examples" / "minimal" / ref).resolve().exists(), ref)


if __name__ == "__main__":
    unittest.main()
