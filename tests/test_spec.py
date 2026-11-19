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

DATA = ROOT / "stories"


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
        spec.validate_story("X", story(status="proposed"))

    def test_mistakes_are_refused_with_a_message(self):
        bad = {
            "unknown key": (story(colour="red"), "unknown key"),
            "missing result": (story(result=""), "result is required"),
            "unknown status": (story(status="maybe"), "status must be"),
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
    def test_every_page_is_deterministic_and_self_contained(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = Path(d) / "a", Path(d) / "b"
            build.build(DATA, a)
            build.build(DATA, b)
            names = sorted(p.name for p in a.iterdir())
            self.assertEqual(names, sorted(p.name for p in b.iterdir()))
            for name in ("index.html", "stories.html", "about.html"):
                self.assertIn(name, names)
            for name in names:
                self.assertEqual((a / name).read_bytes(), (b / name).read_bytes(), name)
            pages = {name: (a / name).read_text() for name in names}
        for name, page in pages.items():
            with self.subTest(name):
                self.assertNotRegex(page, r"<script[^>]+src=", "no external script")
                self.assertNotRegex(page, r"<link[^>]+href=", "no external stylesheet")
                self.assertNotRegex(page, r"url\(\s*['\"]?https?:", "no external resource in the styles")
                self.assertIn("prefers-color-scheme: dark", page)
                self.assertIn('data-theme-set="dark"', page)

    def test_the_stories_page_is_light_and_the_explanation_is_on_its_own_page(self):
        with tempfile.TemporaryDirectory() as d:
            build.build(DATA, Path(d))
            index, about = (Path(d) / "stories.html").read_text(), (Path(d) / "about.html").read_text()
        for section in ('id="picture"', 'id="how"', 'id="principles"', 'id="need"'):
            self.assertNotIn(section, index, "moved to about.html: " + section)
            self.assertIn(section, about)
        self.assertIn('href="about.html"', index, "the stories page says where the explanation is")
        self.assertIn('href="stories.html#Z3"', about, "the explanation links back to the stories")
        self.assertIn('href="stories.html"', about)

    def test_the_page_has_every_story_once_with_a_text_version(self):
        with tempfile.TemporaryDirectory() as d:
            result = build.build(DATA, Path(d))
            page = (Path(d) / "stories.html").read_text()
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


OPTIONS = [{"label": "A", "detail": "a", "proposed": True}, {"label": "B", "detail": "b"}]


class DiscussionTest(unittest.TestCase):
    def test_only_a_story_with_alternatives_or_a_proposed_case_can_be_discussed(self):
        spec.validate_story("X", story(decision={"question": "q", "options": OPTIONS}, discussion=True))
        spec.validate_story("X", story(status="proposed", discussion={"link": "https://github.com/o/r/issues/1", "note": "n"}))
        with self.assertRaises(spec.SpecError):
            spec.validate_story("X", story(discussion=True))

    def test_a_discussion_has_a_web_address_and_a_note_and_nothing_else(self):
        for bad in ({"link": "not a link"}, {"url": "https://x.y"}, {"note": 3}, "yes"):
            with self.subTest(bad), self.assertRaises(spec.SpecError):
                spec.validate_story("X", story(status="proposed", discussion=bad))

    def test_the_pages_say_how_firm_each_answer_is_and_list_what_is_discussed(self):
        src = build.load(DATA)
        by_status = {}
        for sid in src["stories"]:
            by_status.setdefault(build.status_of(src, sid), []).append(sid)
        self.assertEqual(len(by_status["provisional"]), 8)
        self.assertEqual(sorted(by_status["open"]), ["AI5", "AI6", "AI7"])
        with tempfile.TemporaryDirectory() as d:
            build.build(DATA, Path(d))
            current = (Path(d) / "current.html").read_text()
            discussion = (Path(d) / "discussion.html").read_text()
        self.assertEqual(current.count('class="state-row"'), len(src["stories"]))
        self.assertEqual(current.count('data-status="settled"'), 58)
        opted_in = [sid for sid, s in src["stories"].items() if build.discussed(s)]
        self.assertEqual(len(opted_in), 11)
        self.assertEqual(discussion.count('class="talk"'), 11)
        self.assertNotIn('class="talk-join"', discussion, "no link, no button")

    def test_a_link_makes_a_join_button(self):
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / "data"
            shutil.copytree(DATA, data)
            path = data / "storyboards" / "residual.yaml"
            text = path.read_text().replace("    discussion: true\n    decision:", "    discussion: {link: 'https://github.com/o/r/issues/7', note: 'Leaning to the first.'}\n    decision:", 1)
            path.write_text(text)
            build.build(data, Path(d) / "out")
            page = (Path(d) / "out" / "discussion.html").read_text()
        self.assertIn('class="talk-join" href="https://github.com/o/r/issues/7"', page)
        self.assertIn("Leaning to the first.", page)


class PreviewTest(unittest.TestCase):
    """A pull request's preview opens on what the pull request changes."""

    def _head(self, d: Path) -> Path:
        """The stories of a pull request that adds one story, changes the result of one and removes one."""
        import copy

        import yaml

        head = d / "head"
        shutil.copytree(DATA, head)
        path = head / "storyboards" / "residual.yaml"
        body = yaml.safe_load(path.read_text())
        scenarios = body["scenarios"]
        new = copy.deepcopy(scenarios["Z1"])
        new.update(title="A tab loses its connection a moment after typing", status="proposed")
        new.pop("decision"), new.pop("discussion")
        scenarios["NEW1"] = new
        scenarios["Z2"]["result"] = "The newer typing is kept in every copy."
        del scenarios["Z4"]
        path.write_text(yaml.safe_dump(body, sort_keys=False, width=200))
        return head

    def test_the_diff_sorts_stories_into_new_changed_and_removed(self):
        base = build.load(DATA)["stories"]
        head = dict(base)
        head["NEW1"] = dict(base["Z1"], title="new")
        head["Z2"] = dict(base["Z2"], result="different")
        del head["Z4"]
        change = build.diff_stories(base, head)
        self.assertEqual(change, {"new": ["NEW1"], "changed": {"Z2": ["result"]}, "removed": ["Z4"]})
        self.assertEqual(build.diff_stories(base, base), {"new": [], "changed": {}, "removed": []})

    def test_a_preview_opens_on_the_change_and_keeps_the_whole_site(self):
        with tempfile.TemporaryDirectory() as d:
            head = self._head(Path(d))
            build.build(head, Path(d) / "out", base_data=DATA, pr="7")
            pages = {p.name: p.read_text() for p in (Path(d) / "out").iterdir()}
        self.assertEqual(sorted(pages), ["about.html", "current.html", "discussion.html", "index.html", "stories.html", "welcome.html"])
        index = pages["index.html"]
        self.assertIn("pull request #7", index)
        self.assertIn("1 new, 1 changed, 1 removed", index)
        for sid, tag in (("NEW1", "New"), ("Z2", "Changed"), ("Z4", "Removed")):
            self.assertRegex(index, r'<span class="tag[^"]*">%s</span><span class="state-id">%s</span>' % (tag, sid))
        self.assertEqual(index.count('class="story-card"'), 2, "the new and the changed story are played; the removed one is not")
        self.assertIn("<b>Before</b>", index)
        self.assertIn("The newer typing is kept in every copy.", index)
        # the whole site is there, and every page can get back to the change and to the welcome page
        for name in ("stories.html", "about.html", "current.html", "discussion.html", "welcome.html"):
            self.assertIn('<a href="index.html">This change</a>', pages[name], name)
            self.assertIn('href="welcome.html" aria-label', pages[name], name + " links home to the welcome page")
        self.assertIn('class="welcome"', pages["welcome.html"])

    def test_a_pull_request_that_changes_no_story_is_the_ordinary_site(self):
        with tempfile.TemporaryDirectory() as d:
            build.build(DATA, Path(d) / "out", base_data=DATA, pr="8")
            names = sorted(p.name for p in (Path(d) / "out").iterdir())
            index = (Path(d) / "out" / "index.html").read_text()
        self.assertNotIn("welcome.html", names)
        self.assertIn('class="welcome"', index)
        self.assertNotIn("This change", index)


class EditLinkTest(unittest.TestCase):
    def test_a_story_links_to_the_file_of_its_group_and_every_page_says_how_to_change_it(self):
        src = build.load(DATA)
        group = src["stories"]["Z3"]["group"]
        with tempfile.TemporaryDirectory() as d:
            build.build(DATA, Path(d))
            pages = {p.name: p.read_text() for p in Path(d).iterdir()}
        edit = f"{build.REPO}/edit/main/stories/storyboards/{group}.yaml"
        for name in ("stories.html", "current.html", "discussion.html"):
            self.assertIn(f'href="{edit}"', pages[name], name + " links Z3 to the file it is written in")
        self.assertEqual(pages["stories.html"].count('class="edit-story-row"'), len(src["stories"]), "one link a story")
        for name, page in pages.items():
            self.assertIn('<footer class="site-foot">', page, name)
            self.assertIn("Report a problem", page, name)
        self.assertIn("Edit this page on GitHub", pages["about.html"])
        self.assertIn("examples/storyboards/about.template.html", pages["about.html"])
        self.assertIn("Edit the stories on GitHub", pages["current.html"])
