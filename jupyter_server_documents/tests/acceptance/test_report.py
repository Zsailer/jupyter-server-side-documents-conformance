"""Tests of how a run is worded. They need no Node.

A green run must not read as "the tree is fine". The first thing the report says is how many scenarios end as they should and which
do not; what the change did relative to ``suite.yaml`` (the only thing the exit status says) comes after it.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from . import conftest, report
from .report import Entry


def entry(sid: str, outcome: str, observed: str, why: str = "", summary: str = "ended", policy: str = "decided") -> Entry:
    expected = {"pass": "reference", "n/a": "n/a"}.get(outcome, "floor")
    return Entry(
        id=sid, group="g", title=f"title of {sid}", says="says", expected=expected, observed=observed, outcome=outcome, summary=summary, why=why, policy=policy
    )


OK = lambda sid: entry(sid, "pass", "reference")  # noqa: E731
GAP = lambda sid, why="because": entry(sid, "gap", "floor", why=why, summary=f"{sid} lost it")  # noqa: E731
NA = lambda sid: entry(sid, "n/a", "-", why="needs persisted_lineage")  # noqa: E731


def board(*entries: Entry, profile: str = "stopgap", features: frozenset[str] = frozenset()) -> report.Scoreboard:
    return report.scoreboard(list(entries), profile, set(features))


def test_it_says_how_many_end_as_they_should_and_names_the_ones_that_do_not() -> None:
    b = board(OK("A"), OK("B"), OK("C"), GAP("D"), GAP("E"), NA("F"))
    assert b.headline == "3 of the 5 scenarios that can be played on a tree of kind 'stopgap' (features: none) end as they should; 2 do not."
    assert "2 known gaps, recorded in suite.yaml: D E" in b.details
    assert "1 cannot be played on this tree (needs persisted_lineage): F" in b.details
    assert not b.all_fine


def test_the_ones_that_end_as_they_should_only_under_a_best_effort_answer_are_named() -> None:
    b = board(OK("A"), entry("P", "pass", "reference", policy="best_effort"), entry("Q", "pass", "reference", policy="best_effort"), GAP("D"))
    assert "2 of the 3 that end as they should do so under a best-effort answer, not yet confirmed: P Q" in b.details
    assert not any("best-effort" in line for line in board(OK("A"), GAP("D")).details)


def test_the_ones_that_end_as_they_should_only_under_a_suggestion_nobody_has_answered_are_named() -> None:
    b = board(OK("A"), entry("P", "pass", "reference", policy="pending"), entry("Q", "pass", "reference", policy="best_effort"), GAP("D"))
    assert "1 of the 3 that end as they should do so under a suggestion nobody has answered yet: P" in b.details
    assert "1 of the 3 that end as they should do so under a best-effort answer, not yet confirmed: Q" in b.details
    assert not any("suggestion" in line for line in board(OK("A"), GAP("D")).details)


def test_one_that_does_not_is_worded_in_the_singular() -> None:
    assert board(OK("A"), GAP("D")).headline.endswith("end as they should; 1 does not.")


def test_a_not_applicable_scenario_is_neither_fine_nor_short() -> None:
    fine, short, absent = report.split([OK("A"), GAP("D"), NA("F")])
    assert [e.id for e in fine] == ["A"] and [e.id for e in short] == ["D"] and [e.id for e in absent] == ["F"]


def test_only_when_all_end_as_they_should_is_the_headline_good_news() -> None:
    b = board(OK("A"), OK("B"), NA("F"), profile="lineage+healing", features=frozenset({"healing", "persisted_lineage"}))
    assert b.headline == "All 2 scenarios that can be played on a tree of kind 'lineage+healing' (features: healing, persisted_lineage) end as they should."
    assert b.all_fine and not b.caveat


def test_nothing_played_is_not_good_news() -> None:
    b = board(NA("F"))
    assert b.headline.startswith("No scenario can be played") and not b.all_fine


def test_a_green_run_is_not_called_fine_while_some_scenario_ends_short() -> None:
    b = board(OK("A"), GAP("D"))
    assert b.against_suite == "Against what suite.yaml expects of this kind of tree: 0 regressions, 0 improvements."
    assert "judges the change, not the tree" in b.caveat


def test_a_regression_and_an_improvement_are_counted_against_suite_yaml_and_a_regression_ends_short() -> None:
    worse = entry("W", "regression", "none")
    better_but_short = entry("B", "improvement", "floor")
    better_and_fine = entry("R", "improvement", "reference")
    broken = entry("E", "error", "-")
    b = board(OK("A"), worse, better_but_short, better_and_fine, broken)
    assert b.headline.startswith("2 of the 5 scenarios")  # A and R end as they should
    assert "1 WORSE than suite.yaml expects: W" in b.details
    assert "1 better than suite.yaml expects, still short of the reference: B" in b.details
    assert "1 raised before they ended: E" in b.details
    assert b.against_suite.endswith("2 regressions, 2 improvements.")


def test_the_terminal_shows_a_tree_with_gaps_in_red_and_a_tree_without_in_green() -> None:
    with_gaps = report.terminal_lines([OK("A"), GAP("D")], "stopgap", set(), {})
    headline = next(markup for text, markup in with_gaps if "end as they should" in text)
    assert headline.get("red") and not headline.get("green")
    clean = report.terminal_lines([OK("A")], "stopgap", set(), {})
    headline = next(markup for text, markup in clean if "end as they should" in text)
    assert headline.get("green") and not headline.get("red")


def test_the_markdown_leads_with_the_headline_and_tabulates_what_does_not_end_as_it_should() -> None:
    md = report.markdown([OK("A"), GAP("D", why="the  merge\nloses it"), NA("F")], "stopgap", set(), {"commit": "abc"})
    lines = md.splitlines()
    assert lines[0] == "# Acceptance matrix"
    assert lines[4].startswith("**1 of the 2 scenarios that can be played on a tree of kind 'stopgap'") and lines[4].endswith("1 does not.**")
    assert md.index("## Scenarios that do not end as they should (1)") < md.index("## All scenarios")
    assert "| D | D lost it | known gap: the merge loses it |" in md
    assert "judges the change, not the tree" in md


def test_the_json_counts_the_scenarios_that_do_not_end_as_they_should() -> None:
    data = json.loads(report.to_json([OK("A"), GAP("D"), NA("F")], "stopgap", set(), {}))
    assert data["summary"]["playable"] == 2
    assert data["summary"]["end_as_they_should"] == 1
    assert data["summary"]["do_not_end_as_they_should"] == 1
    assert data["summary"]["gap"] == 1 and data["summary"]["n/a"] == 1


# --------------------------------------------------------------------------
# pytest's own words
# --------------------------------------------------------------------------
def _report(nodeid: str, wasxfail: str | None, skipped: bool = True) -> SimpleNamespace:
    r = SimpleNamespace(nodeid=nodeid, skipped=skipped)
    if wasxfail is not None:
        r.wasxfail = wasxfail
    return r


SCENARIO = "jupyter_server_documents/tests/acceptance/test_acceptance.py::test_scenario[C2]"


@pytest.mark.parametrize(
    "nodeid, wasxfail, expected",
    [
        (SCENARIO, "In Yjs a move is a deletion plus an insertion", ("known gaps", "g", "GAP")),
        ("test_acceptance.py::test_scenario[C2]", "a reason", ("known gaps", "g", "GAP")),
        (SCENARIO, "policy pending: who wins?", ("pending a policy", "p", "PENDING")),
        (SCENARIO, None, None),  # a plain skip (not applicable) keeps pytest's word
        ("jupyter_server_documents/tests/test_other.py::test_x", "an xfail of some other test", None),
    ],
)
def test_a_known_gap_is_not_called_xfailed(nodeid: str, wasxfail: str | None, expected) -> None:
    assert conftest.pytest_report_teststatus(_report(nodeid, wasxfail), None) == expected
