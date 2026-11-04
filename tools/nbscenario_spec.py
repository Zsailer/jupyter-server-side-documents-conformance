"""The scenario spec: what a story may say, and a validator that tells an author what is wrong.

A story is a plain dict (YAML or JSON). The grammar is documented in docs/02-spec-reference.md; this module is its
executable form, and tests/test_spec.py checks that it agrees with player/nbscenario.js.
"""
from __future__ import annotations

import re
from typing import Any

#: lanes in the order they are drawn, with their default names
LANES = {
    "tab": "Your tab",
    "tab2": "Second tab",
    "tab3": "Third tab",
    "tab4": "Fourth tab",
    "ai": "AI agent",
    "server": "Server",
    "record": "History record",
    "store": "Output store",
    "file": "File on disk",
}
#: lanes that act on the notebook but hold no copy of it
NO_COPY = frozenset({"ai"})

KINDS = (
    "open", "offline", "reconnect", "leave", "type", "add", "delete", "move", "run", "free",
    "rebuild", "crash", "save", "deadline", "fault", "late", "outside", "restore", "remove", "note",
)

STORY_KEYS = {"id", "title", "story", "lanes", "start", "steps", "result", "ends", "risk", "decision", "badges"}
REQUIRED = ("title", "story", "steps", "result", "ends")
STEP_KEYS = {"at", "kind", "text", "cells", "to"}

_CELL = re.compile(r"^(?P<mark>[+\-^?#!]?)(?P<name>[^=]*?)(?:=(?P<note>.*))?$", re.S)


class SpecError(ValueError):
    """The story is wrong; the message says where."""


def parse_cell(token: str) -> tuple[str, str, str]:
    """(mark, name, note) of a cell token; a token starting with * is a remark."""
    if token.startswith("*"):
        return "*", token[1:].strip(), ""
    m = _CELL.match(token)
    return m.group("mark"), m.group("name").strip(), (m.group("note") or "").strip()


def _check_cells(cells: Any, where: str) -> None:
    if isinstance(cells, str):
        return
    if not isinstance(cells, list):
        raise SpecError(f"{where}: cells is a list of cell strings, a remark, or []")
    for c in cells:
        if not isinstance(c, str) or not parse_cell(c)[1]:
            raise SpecError(f"{where}: {c!r} is not a cell (marks: + - ^ ? # !, a note after =, * for a remark)")


def _lanes_of(step: dict) -> list[str]:
    at = step["at"]
    return list(at) if isinstance(at, list) else [at]


def _check_lane(lane: Any, where: str) -> None:
    if lane not in LANES:
        raise SpecError(f"{where}: {lane!r} is not a lane (one of {list(LANES)})")


def drawn_lanes(story: dict) -> list[str]:
    """The lanes a story draws, in drawing order: those it lists, else those it uses."""
    given = story.get("lanes") or {}
    if given:
        return [lane for lane in LANES if lane in given]
    used = set(story.get("start") or {"file": 1}) | (set(story["ends"]) - {"all"})
    for step in story["steps"]:
        used |= set(_lanes_of(step)) | ({step["to"]} if step.get("to") else set())
    return [lane for lane in LANES if lane in used]


def validate_story(sid: str, story: dict) -> None:
    """Raise SpecError if the story is not well formed."""
    where = f"story {sid}"
    unknown = set(story) - STORY_KEYS - {"group"}
    if unknown:
        raise SpecError(f"{where}: unknown key(s) {sorted(unknown)}")
    for key in REQUIRED:
        if not story.get(key):
            raise SpecError(f"{where}: {key} is required")
    for lane in story.get("lanes") or {}:
        _check_lane(lane, f"{where}, lanes")
    used: set[str] = set()
    for i, step in enumerate(story["steps"], 1):
        w = f"{where}, step {i}"
        if set(step) - STEP_KEYS or not {"at", "kind", "text"} <= set(step):
            raise SpecError(f"{w}: a step has at, kind, text and, optionally, cells and to")
        if step["kind"] not in KINDS:
            raise SpecError(f"{w}: kind {step['kind']!r} is not one of {sorted(KINDS)}")
        for lane in _lanes_of(step) + ([step["to"]] if step.get("to") else []):
            _check_lane(lane, w)
            used.add(lane)
        if "cells" in step:
            _check_cells(step["cells"], w)
            if set(_lanes_of(step)) <= NO_COPY:
                raise SpecError(f"{w}: {_lanes_of(step)} holds no copy of the notebook, so the step has no cells")
    listed = set(story.get("lanes") or {})
    if listed and used - listed:
        raise SpecError(f"{where}: the steps use {sorted(used - listed)}, which `lanes` does not list")
    for what, mapping in (("start", story.get("start") or {}), ("ends", story["ends"])):
        for lane, cells in mapping.items():
            if lane != "all":
                _check_lane(lane, f"{where}, {what}")
            _check_cells(cells, f"{where}, {what}.{lane}")
        if set(mapping) & NO_COPY:
            raise SpecError(f"{where}: {what} names {sorted(set(mapping) & NO_COPY)}, which holds no copy of the notebook")
        hidden = set(mapping) - {"all"} - set(drawn_lanes(story))
        if hidden:
            raise SpecError(f"{where}: {what} holds {sorted(hidden)}, which is not drawn (see `lanes`)")
    decision = story.get("decision")
    if decision:
        if not decision.get("question") or len(decision.get("options") or []) < 2:
            raise SpecError(f"{where}: a decision has a question and at least two options")
        if sum(bool(o.get("proposed")) for o in decision["options"]) != 1:
            raise SpecError(f"{where}: exactly one option of a decision is the proposed one")
        for o in decision["options"]:
            if set(o) - {"label", "detail", "proposed", "ends"} or not o.get("label") or not o.get("detail"):
                raise SpecError(f"{where}: an option has a label, a detail and, optionally, proposed and ends")
            if "ends" in o:
                _check_cells(o["ends"], f"{where}, option {o['label']!r}")
