"""Tests of the storyboards (``storyboards/``) and of the page drawn from them. They need no Node and run in every job.

The storyboards are the one part of the generated documents that people write by hand, so they are checked against what is
written elsewhere: every scenario of ``suite.yaml`` has one, the ones whose answer is not settled have a decision and only those,
and the page says nothing of any implementation: it is about the product.
"""
from __future__ import annotations

import copy
import re

import pytest
import yaml

from . import render, storyboard, suite

SUITE = suite.get()
SPEC = storyboard.load()


def _text_of(html: str) -> str:
    body = re.sub(r"<style>.*?</style>|<script>.*?</script>", "", html, flags=re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body)).lower()


def test_every_scenario_has_a_storyboard_and_every_storyboard_is_well_formed() -> None:
    storyboard.check(SPEC, SUITE)
    assert set(SPEC["scenarios"]) == set(SUITE.scenarios)


def test_a_storyboard_is_in_the_file_of_its_group() -> None:
    for sid, sb in SPEC["scenarios"].items():
        assert sb["group"] == SUITE.scenarios[sid].group, sid


def test_exactly_the_scenarios_that_are_not_settled_have_a_decision() -> None:
    open_in_suite = {sid for sid, scn in SUITE.scenarios.items() if scn.best_effort or scn.pending}
    with_decision = {sid for sid, sb in SPEC["scenarios"].items() if sb.get("decision")}
    assert with_decision == open_in_suite


def test_a_decision_proposes_one_option_and_suite_yaml_says_what_was_chosen() -> None:
    """The storyboard words the options; what was chosen provisionally is `policy.decision` of suite.yaml, which the proposal restates."""
    for sid, sb in SPEC["scenarios"].items():
        if not sb.get("decision"):
            continue
        assert SUITE.scenarios[sid].policy.decision, f"{sid}: suite.yaml says nothing of what was chosen, so there is nothing to propose"
        assert sum(bool(o.get("proposed")) for o in sb["decision"]["options"]) == 1, sid


def test_a_tab_opens_the_notebook_before_it_does_anything_else() -> None:
    for sid, sb in SPEC["scenarios"].items():
        seen: set[str] = set()
        for i, step in enumerate(sb["steps"], 1):
            for lane in storyboard._lanes_of(step):
                if lane.startswith("tab") and lane not in seen:
                    assert step["kind"] == "open", f"{sid}, step {i}: {lane} must open the notebook before anything else"
                    seen.add(lane)


def test_a_tab_that_left_or_went_offline_comes_back_before_it_acts_online() -> None:
    """After `leave`, `offline` or `crash` a lane may only edit offline, come back, or (for a tab that left) stay away."""
    offline_kinds = {"type", "add", "delete", "move"}
    for sid, sb in SPEC["scenarios"].items():
        away: dict[str, str] = {}
        for i, step in enumerate(sb["steps"], 1):
            for lane in storyboard._lanes_of(step):
                if lane in away and step["kind"] not in offline_kinds | {"reconnect", "open", "rebuild"}:
                    raise AssertionError(f"{sid}, step {i}: {lane} is {away[lane]} and cannot {step['kind']}")
                if step["kind"] in ("offline", "leave", "crash"):
                    away[lane] = step["kind"]
                elif step["kind"] in ("reconnect", "open", "rebuild"):
                    away.pop(lane, None)


def test_the_page_says_nothing_of_any_implementation() -> None:
    text = _text_of(storyboard.render_page(SUITE))
    found = sorted(w for w in storyboard.IMPLEMENTATION_WORDS if w in text)
    assert not found, f"the page is about the product; these words belong to an implementation: {found}"


def _strings(node):
    """Every string a YAML document says (its values, not the names of its keys)."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from _strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from _strings(value)


def test_the_yaml_of_the_storyboards_says_nothing_of_any_implementation() -> None:
    for path in storyboard.STORYBOARDS_DIR.glob("*.yaml"):
        text = " ".join(_strings(yaml.safe_load(path.read_text()))).lower()
        found = sorted(w for w in storyboard.IMPLEMENTATION_WORDS if w in text)
        assert not found, f"{path.name}: these words belong to an implementation: {found}"


def test_the_page_is_deterministic_and_self_contained() -> None:
    html = storyboard.render_page(SUITE)
    assert html == storyboard.render_page(SUITE)
    assert html.startswith("<!doctype html>")
    assert not re.search(r"""(?:src|href)=["'](?:https?:)?//""", html), "the page must not need the network"
    assert html.count("<article class=") == len(SUITE.scenarios)


def test_the_page_is_part_of_the_generated_documents() -> None:
    assert storyboard.STORYBOARDS_HTML in render.render_all()


def test_a_page_can_be_drawn_for_a_few_stories_only() -> None:
    html = storyboard.render(SPEC, SUITE, only=("B", "Z3"))
    assert html.count("<article class=") == 2
    assert 'id="B"' in html and 'id="Z3"' in html
    assert "principles" not in html.split("</style>", 1)[1]


def test_markup_in_a_text_is_escaped() -> None:
    spec = copy.deepcopy(SPEC)
    spec["scenarios"]["A"]["title"] = "<script>alert(1)</script> & more"
    html = storyboard.render(spec, SUITE)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt; &amp; more" in html


@pytest.mark.parametrize(
    ("token", "look", "name", "note"),
    [
        ("c0", "plain", "c0", ""),
        ("c0=+OFFLINE", "edited", "c0", "+OFFLINE"),
        ("+new cell", "new", "new cell", ""),
        ("-c1", "gone", "c1", ""),
        ("^c0", "moved", "c0", ""),
        ("?c1=recovered", "copy", "c1", "recovered"),
        ("#c0=1 output", "out", "c0", "1 output"),
        ("!c0=twice", "bad", "c0", "twice"),
        ("*a remark", "remark", "a remark", ""),
        ("c0=total = a * b", "edited", "c0", "total = a * b"),
    ],
)
def test_cells(token: str, look: str, name: str, note: str) -> None:
    assert storyboard.parse_cell(token) == (look, name, note)


def _broken(edit) -> dict:
    spec = copy.deepcopy(SPEC)
    edit(spec)
    return spec


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (lambda s: s["scenarios"].pop("A"), "no storyboard for"),
        (lambda s: s["scenarios"].update(NOPE=dict(s["scenarios"]["A"])), "does not have"),
        (lambda s: s["scenarios"]["A"].update(extra=1), "unknown key"),
        (lambda s: s["scenarios"]["A"].pop("result"), "result is required"),
        (lambda s: s["scenarios"]["A"]["steps"][0].update(kind="dance"), "not one of"),
        (lambda s: s["scenarios"]["A"]["steps"][0].update(at="moon"), "not a lane"),
        (lambda s: s["scenarios"]["A"]["steps"][0].update(cells=["="]), "is not a cell"),
        (lambda s: s["scenarios"]["A"].update(lanes={"tab": "Your tab"}), "which `lanes` does not list"),
        (lambda s: s["scenarios"]["C3"].update(ends={"tab3": ["c0"]}), "not drawn"),
        (lambda s: s["scenarios"]["A"].update(decision=dict(question="?", options=[dict(label="a", detail="b", proposed=True), dict(label="c", detail="d")])), "settled"),
        (lambda s: s["scenarios"]["Z3"].pop("decision"), "needs a decision"),
        (lambda s: s["scenarios"]["Z3"]["decision"]["options"][0].pop("proposed"), "exactly one option"),
        (lambda s: s["scenarios"]["Z3"]["decision"]["options"][1].update(proposed=True), "exactly one option"),
        (lambda s: s["scenarios"]["A"].update(group="edges"), "is in the group"),
        (lambda s: s["groups"].pop("stop"), "needs a title and an intro"),
        (lambda s: s["groups"].update(zzz=dict(title="t", intro="i")), "does not have"),
        (lambda s: s["page"].pop("principles"), "principles is required"),
        (lambda s: s["page"]["applies_if"].update(persisted_lineage={"badge": "only"}), "needs a badge and a text"),
    ],
)
def test_a_malformed_storyboard_is_refused(edit, message: str) -> None:
    with pytest.raises(storyboard.StoryboardError, match=message):
        storyboard.check(_broken(edit), SUITE)
