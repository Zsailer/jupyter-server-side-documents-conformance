"""Storyboards: the scenarios of ``suite.yaml`` drawn as pictures of what the product does.

``storyboards/`` has, for every scenario of the suite, a short story, the steps in the order they happen (who does what: a tab, the
server, the file), and what the notebook must look like when it is over. This module checks those files against ``suite.yaml`` and
renders them as one self-contained HTML page (``STORYBOARDS.html``: no network, no script needed to read it), made to be browsed in a
design review and hosted as it is.

The page is about the PRODUCT, not about any version of the code: it says what a user must be able to count on and, where that is
still a decision, what the options are. It deliberately knows nothing of which tree gets it right (``CATALOGUE.md`` does).

Layout of ``storyboards/``::

    page.yaml        the page: title, introduction, principles, and a title and an introduction for each group of the suite
    <group>.yaml     the storyboards of the scenarios of that group of ``suite.yaml`` (one file per group, `scenarios:`)

A storyboard::

    A:
      title: "..."
      story: "..."                       # what happens, in plain words
      lanes: {tab: "First tab", ...}     # optional: which columns, and what they are called
      start: {file: [c0, c1, c2]}        # optional: what each lane holds at the start (the file holds c0, c1, c2 by default)
      steps:
        - {at: tab, kind: type, text: "types ...", cells: ["c0=+OFFLINE", c1, c2], to: server}
      result: "..."                      # what the product does
      ends: {all: [c0, c1, c2]}          # what every lane holds at the end (or one entry per lane)
      risk: "..."                        # optional: what a user would see if it went wrong
      decision: ...                      # exactly for the scenarios whose answer is not settled (see below)

``at`` is a lane (``tab``, ``tab2``, ``tab3``, ``tab4``, ``server``, ``record``, ``store``, ``file``) or a list of lanes that do the
same thing together (drawn as one box when they are next to each other); ``kind`` picks the icon (see ``KINDS``); ``to`` adds an
arrow to another lane; ``cells`` is what that lane's copy of the notebook holds after the step.

A cell is a short string. The first character is a mark, ``=`` starts a note::

    c0                  a cell
    c0=+OFFLINE         a cell that was edited, with what changed
    +typed offline      a cell that was added          -c1              a cell that was removed
    ^c0                 a cell that was moved          ?c1=recovered    a copy set aside for the user
    #c0=1 output        a cell with an output          !c0=twice        something that must never happen
    *text               a remark, not a cell

``cells`` may also be a plain string (a remark about that lane) or ``[]`` (nothing).

A scenario whose answer is not settled (``policy`` of ``suite.yaml`` is ``best_effort`` or ``pending``) has a ``decision``: the
question, and options of which exactly one is ``proposed``. A scenario that is settled has none.

A group of ``page.yaml`` with ``played: false`` holds stories that ``suite.yaml`` does not have: situations the product has to answer
for that no scenario plays yet (today, the ones with an AI agent). They are drawn like the others, marked as not played so that nobody
takes them for verified, and their decisions are "suggested" rather than "proposed", because nobody has discussed them yet. A story
there may have a ``decision`` or not. A story moves out of such a group when a scenario is written for it.
"""
from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

import yaml

HERE = Path(__file__).resolve().parent
STORYBOARDS_DIR = HERE / "storyboards"
STORYBOARDS_HTML = HERE / "STORYBOARDS.html"

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

#: lanes that act on the notebook but hold no copy of it: no cells are drawn for them
NO_COPY = frozenset({"ai"})

#: kind of step -> icon. An icon is only a help: every step says what it is in words.
KINDS = {
    "open": "enter",
    "offline": "pause",
    "reconnect": "swap",
    "leave": "exit",
    "type": "pencil",
    "add": "plus",
    "delete": "cross",
    "move": "updown",
    "run": "play",
    "free": "exit",
    "rebuild": "refresh",
    "crash": "bolt",
    "save": "down",
    "deadline": "clock",
    "fault": "lost",
    "late": "hourglass",
    "outside": "doc",
    "restore": "undo",
    "remove": "bin",
    "note": "info",
}

#: the kinds shown in the legend, with what they mean
LEGEND_KINDS = {
    "open": "opens the notebook",
    "offline": "loses its connection",
    "reconnect": "reconnects",
    "type": "types, adds, moves, deletes",
    "free": "lets go of the notebook",
    "rebuild": "builds it again from the file",
    "save": "saves to the file",
    "fault": "a message is lost",
    "late": "a message is late",
    "deadline": "waits, then carries on",
    "crash": "the server dies",
    "outside": "the file is changed outside",
}

#: 16x16 drawings (stroke only unless said otherwise); `play` and `pause` are filled
ICONS = {
    "enter": '<path d="M10 3h3v10h-3M7 5l3 3-3 3M10 8H3"/>',
    "exit": '<path d="M6 3H3v10h3M9 5l3 3-3 3M12 8H6"/>',
    "pause": '<path class="f" d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z"/>',
    "play": '<path class="f" d="M5 3l8 5-8 5z"/>',
    "swap": '<path d="M3 6h9M9.5 3.5L12 6l-2.5 2.5M13 10H4M6.5 7.5L4 10l2.5 2.5"/>',
    "refresh": '<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3"/>',
    "pencil": '<path d="M3 13l.8-3L11 2.8 13.2 5 6 12.2zM9.5 4.3l2.2 2.2"/>',
    "plus": '<path d="M8 3v10M3 8h10"/>',
    "cross": '<path d="M4 4l8 8M12 4l-8 8"/>',
    "updown": '<path d="M5 13V3M2.5 5.5L5 3l2.5 2.5M11 3v10M8.5 10.5L11 13l2.5-2.5"/>',
    "bolt": '<path class="f" d="M9.5 1.5L4 9h3.5l-1 5.5L12 7H8.5z"/>',
    "down": '<path d="M8 2.5v7.5M4.8 7.2L8 10.4l3.2-3.2M3 13.5h10"/>',
    "clock": '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.4"/>',
    "lost": '<rect x="2" y="4" width="12" height="8.5" rx="1.2"/><path d="M2.3 5l5.7 4.2L13.7 5M2.5 14L13.5 2.5" class="r"/>',
    "hourglass": '<path d="M4 2h8M4 14h8M5 2v3l3 3-3 3v3M11 2v3L8 8l3 3v3"/>',
    "doc": '<path d="M4 2h5l3 3v9H4zM9 2v3h3M6 9h4M6 11.5h4"/>',
    "undo": '<path d="M3 8a5 5 0 1 1 1.6 3.7M3 13v-3h3"/>',
    "bin": '<path d="M3.5 4.5h9M6 4.5V3h4v1.5M4.8 4.5l.7 9h5l.7-9"/>',
    "info": '<circle cx="8" cy="8" r="5.8"/><path d="M8 7.2v3.6M8 5v.3"/>',
}

#: cell marks -> the look of the chip
MARKS = {"": "plain", "+": "new", "-": "gone", "^": "moved", "?": "copy", "#": "out", "!": "bad"}

_CELL = re.compile(r"^(?P<mark>[+\-^?#!]?)(?P<name>[^=]*?)(?:=(?P<note>.*))?$", re.S)

#: words that belong to an implementation, not to the product: none may appear on the page
IMPLEMENTATION_WORDS = (
    "stopgap", "healing", "lineage", "syncstep", "ss2", "clientid", "client id", "yjs", "y.doc", "ydoc", "crdt", "pycrdt",
    "token", "checkpoint", "state vector", "tombstone", "profile", "variant", "upstream", "#329", "#333", "#334", "#71",
)


class StoryboardError(ValueError):
    """The storyboards are wrong; the message says where."""


# --------------------------------------------------------------------------
# loading and checking
# --------------------------------------------------------------------------
def load(directory: Path = STORYBOARDS_DIR) -> dict[str, Any]:
    """``{"page": ..., "groups": {...}, "scenarios": {id: storyboard}}`` from the files of the directory.

    A storyboard gets a ``group`` key: the stem of the file it is in.
    """
    spec = yaml.safe_load((directory / "page.yaml").read_text())
    scenarios: dict[str, Any] = {}
    for path in sorted(directory.glob("*.yaml")):
        if path.name == "page.yaml":
            continue
        body = yaml.safe_load(path.read_text()) or {}
        unknown = set(body) - {"scenarios", "shared"}
        if unknown:
            raise StoryboardError(f"{path.name}: unknown key(s) {sorted(unknown)} (a file has `scenarios:` and, for anchors, `shared:`)")
        for sid, sb in (body.get("scenarios") or {}).items():
            if sid in scenarios:
                raise StoryboardError(f"scenario {sid} has a storyboard in two files")
            scenarios[sid] = dict(sb, group=path.stem)
    unknown = set(spec) - {"page", "groups"}
    if unknown:
        raise StoryboardError(f"page.yaml: unknown key(s) {sorted(unknown)}")
    return {"page": spec["page"], "groups": spec["groups"], "scenarios": scenarios}


def parse_cell(token: str) -> tuple[str, str, str]:
    """``(look, name, note)`` of a cell string; ``look`` is one of the values of MARKS, or ``edited`` or ``remark``."""
    if token.startswith("*"):
        return "remark", token[1:].strip(), ""
    m = _CELL.match(token)
    mark, name, note = m.group("mark"), m.group("name").strip(), (m.group("note") or "").strip()
    look = MARKS[mark]
    if look == "plain" and note:
        look = "edited"
    return look, name, note


def _check_cells(cells: Any, where: str) -> None:
    if isinstance(cells, str):
        return
    if not isinstance(cells, list):
        raise StoryboardError(f"{where}: cells is a list of cell strings, a remark, or []")
    for c in cells:
        if not isinstance(c, str) or not parse_cell(c)[1]:
            raise StoryboardError(f"{where}: {c!r} is not a cell (see the top of storyboard.py)")


def _unplayed_groups(spec: dict[str, Any]) -> list[str]:
    """The groups of stories that suite.yaml does not play (``played: false`` in page.yaml), in page order."""
    return [gid for gid, g in spec["groups"].items() if g.get("played") is False]


def _group_order(spec: dict[str, Any], suite) -> list[str]:
    """The groups of the suite, then the ones it does not play."""
    return list(suite.groups) + [gid for gid in spec["groups"] if gid not in suite.groups]


def _group_ids(spec: dict[str, Any], suite, gid: str) -> list[str]:
    """The stories of a group in the order they are drawn: the suite's order for its groups, the file's for the others."""
    if gid in suite.groups:
        return [sid for sid, s in suite.scenarios.items() if s.group == gid and sid in spec["scenarios"]]
    return [sid for sid, sb in spec["scenarios"].items() if sb["group"] == gid]


def _lanes_of(step: dict) -> list[str]:
    at = step["at"]
    return list(at) if isinstance(at, list) else [at]


def _check_lane(lane: Any, where: str) -> None:
    if lane not in LANES:
        raise StoryboardError(f"{where}: {lane!r} is not a lane (one of {list(LANES)})")


def check(spec: dict[str, Any], suite, *, complete: bool = True) -> None:
    """Every scenario of the suite has a storyboard (unless ``complete`` is false), and every storyboard is well formed."""
    scenarios = spec["scenarios"]
    unplayed = set(_unplayed_groups(spec))
    played_and_unplayed = sorted(unplayed & set(suite.groups))
    if played_and_unplayed:
        raise StoryboardError(f"page.yaml calls {played_and_unplayed} unplayed, but suite.yaml has those groups")
    extra = sorted(sid for sid in set(scenarios) - set(suite.scenarios) if scenarios[sid]["group"] not in unplayed)
    if extra:
        raise StoryboardError(
            f"storyboards for scenarios that suite.yaml does not have: {extra} (stories that no scenario plays yet go in a group with `played: false`)"
        )
    if complete:
        missing = sorted(set(suite.scenarios) - set(scenarios))
        if missing:
            raise StoryboardError(f"no storyboard for {missing}")
    for gid in list(suite.groups) + sorted(unplayed):
        if gid not in spec["groups"] or not {"title", "intro"} <= set(spec["groups"][gid]):
            raise StoryboardError(f"group {gid}: page.yaml needs a title and an intro for it")
    for gid in spec["groups"]:
        if gid not in suite.groups and gid not in unplayed:
            raise StoryboardError(f"page.yaml describes a group {gid!r} that suite.yaml does not have (say `played: false` if it is meant)")
    page = spec["page"]
    for key in ("title", "intro", "principles", "decisions_intro", "applies_if", "footer"):
        if not page.get(key):
            raise StoryboardError(f"page.yaml: page.{key} is required")
    if unplayed and not {"badge", "text", "option_label"} <= set(page.get("unplayed") or {}):
        raise StoryboardError("page.yaml: page.unplayed needs a badge, a text and an option_label (there are groups that suite.yaml does not play)")
    for feature in {f for s in suite.scenarios.values() for f in s.requires}:
        if not {"badge", "text"} <= set(page["applies_if"].get(feature) or {}):
            raise StoryboardError(f"page.yaml: page.applies_if needs a badge and a text for the feature {feature!r}")
    for sid, sb in scenarios.items():
        where = f"scenario {sid}" if sid in suite.scenarios else f"story {sid}"
        scn = suite.scenarios.get(sid)
        if scn is not None and sb["group"] != scn.group:
            raise StoryboardError(f"{where} is in the group {scn.group!r} of suite.yaml but its storyboard is in {sb['group']}.yaml")
        unknown = set(sb) - {"group", "title", "story", "lanes", "start", "steps", "result", "ends", "risk", "decision"}
        if unknown:
            raise StoryboardError(f"{where}: unknown key(s) {sorted(unknown)}")
        for key in ("title", "story", "steps", "result", "ends"):
            if not sb.get(key):
                raise StoryboardError(f"{where}: {key} is required")
        lanes = list(sb.get("lanes") or {})
        for lane in lanes:
            _check_lane(lane, f"{where}, lanes")
        used: set[str] = set()
        for i, step in enumerate(sb["steps"], 1):
            w = f"{where}, step {i}"
            if set(step) - {"at", "kind", "text", "cells", "to"} or not {"at", "kind", "text"} <= set(step):
                raise StoryboardError(f"{w}: a step has at, kind, text and, optionally, cells and to")
            if step["kind"] not in KINDS:
                raise StoryboardError(f"{w}: kind {step['kind']!r} is not one of {sorted(KINDS)}")
            for lane in _lanes_of(step) + ([step["to"]] if step.get("to") else []):
                _check_lane(lane, w)
                used.add(lane)
            if "cells" in step:
                _check_cells(step["cells"], w)
                if set(_lanes_of(step)) <= NO_COPY:
                    raise StoryboardError(f"{w}: {_lanes_of(step)} holds no copy of the notebook, so the step has no cells")
        if lanes and used - set(lanes):
            raise StoryboardError(f"{where}: the steps use {sorted(used - set(lanes))}, which `lanes` does not list")
        for lane, cells in (sb.get("start") or {}).items():
            _check_lane(lane, f"{where}, start")
            _check_cells(cells, f"{where}, start.{lane}")
        for lane, cells in sb["ends"].items():
            if lane != "all":
                _check_lane(lane, f"{where}, ends")
            _check_cells(cells, f"{where}, ends.{lane}")
        for what, mapping in (("start", sb.get("start") or {}), ("ends", sb["ends"])):
            if set(mapping) & NO_COPY:
                raise StoryboardError(f"{where}: {what} names {sorted(set(mapping) & NO_COPY)}, which holds no copy of the notebook")
        drawn = set(_lane_labels(sb))
        for what, mapping in (("start", sb.get("start") or {}), ("ends", sb["ends"])):
            hidden = set(mapping) - {"all"} - drawn
            if hidden:
                raise StoryboardError(f"{where}: {what} holds {sorted(hidden)}, which is not drawn (see `lanes`)")
        decision = sb.get("decision")
        if scn is not None:
            settled = not (scn.best_effort or scn.pending)
            if decision and settled:
                raise StoryboardError(f"{where} is settled in suite.yaml (policy: decided) but its storyboard has a decision")
            if not decision and not settled:
                raise StoryboardError(f"{where} is not settled in suite.yaml (policy: {scn.policy.status}) and needs a decision in its storyboard")
        if decision:
            if not decision.get("question") or len(decision.get("options") or []) < 2:
                raise StoryboardError(f"{where}: a decision has a question and at least two options")
            if sum(bool(o.get("proposed")) for o in decision["options"]) != 1:
                raise StoryboardError(f"{where}: exactly one option of a decision is the proposed one")
            for o in decision["options"]:
                if set(o) - {"label", "detail", "proposed", "ends"} or not o.get("label") or not o.get("detail"):
                    raise StoryboardError(f"{where}: an option has a label, a detail and, optionally, proposed and ends")
                if "ends" in o:
                    _check_cells(o["ends"], f"{where}, option {o['label']!r}")


# --------------------------------------------------------------------------
# drawing
# --------------------------------------------------------------------------
def _e(text: Any) -> str:
    return html.escape(str(text), quote=True)


def _icon(kind: str) -> str:
    return f'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">{ICONS[KINDS[kind]]}</svg>'


def _chip(token: str) -> str:
    look, name, note = parse_cell(token)
    if look == "remark":
        return f'<span class="chip remark">{_e(name)}</span>'
    sign = {"new": "+ ", "gone": "× ", "moved": "↕ "}.get(look, "")
    inner = f"{sign}{_e(name)}" + (f"<small>{_e(note)}</small>" if note else "")
    return f'<span class="chip {look}">{inner}</span>'


def _strip(cells: list[str] | str, cls: str = "") -> str:
    if isinstance(cells, str):
        cells = ["*" + cells]
    body = "".join(_chip(c) for c in cells) or '<span class="chip remark">nothing</span>'
    return f'<div class="strip {cls}">{body}</div>'


def _start(sb: dict) -> dict[str, Any]:
    """What each lane holds at the start: by default, the file holds the three cells every story begins with."""
    return sb.get("start") or {"file": ["c0", "c1", "c2"]}


def _lane_labels(sb: dict) -> dict[str, str]:
    """The lanes of a storyboard in drawing order, with their names."""
    given = sb.get("lanes") or {}
    if given:
        return {lane: given[lane] or LANES[lane] for lane in LANES if lane in given}
    used = set(_start(sb)) | (set(sb["ends"]) - {"all"})
    for step in sb["steps"]:
        used |= set(_lanes_of(step)) | ({step["to"]} if step.get("to") else set())
    return {lane: LANES[lane] for lane in LANES if lane in used}


def _board(sid: str, sb: dict) -> str:
    labels = _lane_labels(sb)
    lanes = list(labels)
    col = {lane: i + 2 for i, lane in enumerate(lanes)}  # grid columns, 1 is the step number
    out = [f'<div class="scroll"><div class="board" style="--n:{len(lanes)}" role="group" aria-label="Storyboard of scenario {_e(sid)}">']
    out.append('<div class="corner"></div>' + "".join(f'<div class="lane-head l-{l}">{_e(labels[l])}</div>' for l in lanes))
    start = _start(sb)
    out.append(
        '<div class="no">start</div>'
        + "".join(f'<div class="cell l-{l}">{_strip(start[l]) if l in start else ""}</div>' for l in lanes)
    )
    away = {l: False for l in lanes}  # offline, or gone: drawn hatched
    for i, step in enumerate(sb["steps"], 1):
        at = [l for l in _lanes_of(step) if l in lanes]
        kind = step["kind"]
        coming_back = kind in ("open", "reconnect", "rebuild")
        # a box shared by lanes that touch is drawn once across them; otherwise once in each lane
        groups: list[list[str]] = []
        for l in sorted(at, key=lanes.index):
            if groups and lanes.index(l) == lanes.index(groups[-1][-1]) + 1:
                groups[-1].append(l)
            else:
                groups.append([l])
        by_first = {g[0]: g for g in groups}
        covered = {l for g in groups for l in g}
        row = [f'<div class="no">{i}</div>']
        for l in lanes:
            if l in by_first:
                g = by_first[l]
                to = step.get("to")
                arrow = f'<span class="to l-{to}">→ {_e(labels[to])}</span>' if to and to in labels else ""
                pill = f'<div class="pill k-{kind}">{_icon(kind)}<span>{_e(step["text"])}{arrow}</span></div>'
                if "cells" in step:
                    pill += _strip(step["cells"])
                style = f' style="grid-column:{col[g[0]]}/span {len(g)}"' if len(g) > 1 else ""
                shared = " shared" if len(g) > 1 else ""
                hatched = " off" if all(away[x] for x in g) and not coming_back else ""
                row.append(f'<div class="cell l-{l}{shared}{hatched}"{style}>{pill}</div>')
            elif l in covered:
                continue
            else:
                row.append(f'<div class="cell l-{l}{" off" if away[l] else ""}"></div>')
        for l in at:
            if kind in ("offline", "leave", "crash"):
                away[l] = True
            elif coming_back:
                away[l] = False
        out.append("".join(row))
    ends = sb["ends"]
    out.append(
        '<div class="no end">end</div>'
        + "".join(
            f'<div class="cell end l-{l}">{_strip(ends[l] if l in ends else ends["all"]) if (l in ends or "all" in ends) and l not in NO_COPY else ""}</div>'
            for l in lanes
        )
    )
    out.append("</div></div>")
    return "".join(out)


def _decision(sb: dict, proposed_label: str = "Proposed") -> str:
    d = sb["decision"]
    options = []
    for o in d["options"]:
        flag = f'<span class="flag">{_e(proposed_label)}</span>' if o.get("proposed") else ""
        strip = _strip(o["ends"], "small") if o.get("ends") is not None else ""
        options.append(
            f'<div class="option{" proposed" if o.get("proposed") else ""}"><div class="olabel">{flag}{_e(o["label"])}</div>'
            f'<p>{_e(o["detail"])}</p>{strip}</div>'
        )
    return (
        '<div class="decision"><div class="dhead">Needs alignment</div>'
        f'<p class="question">{_e(d["question"])}</p><div class="options">{"".join(options)}</div></div>'
    )


def _card(sid: str, sb: dict, scn, page: dict[str, Any]) -> str:
    """One story. ``scn`` is its scenario in the suite, or None for a story that no scenario plays yet."""
    open_ = bool(sb.get("decision"))
    badges = ""
    if open_:
        badges += '<span class="badge need">Needs alignment</span>'
    if scn is None:
        badges += f'<span class="badge new" title="{_e(page["unplayed"]["text"])}">{_e(page["unplayed"]["badge"])}</span>'
    else:
        for feature in sorted(scn.requires):
            badges += f'<span class="badge cond" title="{_e(page["applies_if"][feature]["text"])}">{_e(page["applies_if"][feature]["badge"])}</span>'
    body = [
        f'<article class="scn{" has-decision" if open_ else ""}" id="{_e(sid)}">',
        f'<header><span class="id">{_e(sid)}</span><h3>{_e(sb["title"])}</h3>{badges}</header>',
        f'<p class="story">{_e(sb["story"])}</p>',
        _board(sid, sb),
        f'<div class="result"><b>What the product does</b><span>{_e(sb["result"])}</span></div>',
    ]
    if sb.get("risk"):
        body.append(f'<p class="risk"><b>Why it matters</b> {_e(sb["risk"])}</p>')
    if open_:
        body.append(_decision(sb, page["unplayed"]["option_label"] if scn is None else "Proposed"))
    body.append("</article>")
    return "".join(body)


_CSS = """
:root{--ink:#0f172a;--muted:#475569;--line:#cbd5e1;--soft:#e2e8f0;--bg:#f8fafc;--ok:#15803d;--okbg:#ecfdf3;--warn:#b45309;--warnbg:#fff7e6}
*{box-sizing:border-box}
html{scroll-padding-top:56px}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:#1d4ed8}
.wrap{max-width:1200px;margin:0 auto;padding:0 20px 80px}
.top{background:#0f172a;color:#fff;padding:34px 0 26px}
.top .wrap{padding-bottom:0}
.top h1{margin:0 0 8px;font-size:1.9rem;line-height:1.2}
.top p{margin:0;max-width:62rem;color:#cbd5e1}
nav.bar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line)}
nav.bar .wrap{display:flex;gap:6px 12px;flex-wrap:wrap;align-items:center;padding-top:8px;padding-bottom:8px}
nav.bar a{font-size:.82rem;text-decoration:none;color:#334155;padding:3px 9px;border-radius:12px;background:#eef2f7}
nav.bar a:hover{background:#dbe4f0}
nav.bar label{font-size:.82rem;color:#334155;display:flex;gap:5px;align-items:center}
nav.bar input[type=search]{font:inherit;font-size:.82rem;padding:3px 9px;border:1px solid var(--line);border-radius:12px;width:11rem}
h2{margin:44px 0 4px;font-size:1.4rem}
h2+p.intro{margin:0 0 14px;color:var(--muted);max-width:60rem}
.principles{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px;margin:22px 0}
.principles div{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:.92rem}
.principles b{display:block;margin-bottom:3px;font-size:.98rem}
.legend{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:18px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.legend h4{margin:0 0 6px;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.legend p{margin:0 0 6px;font-size:.88rem}
.legend .key{display:flex;gap:6px;align-items:center;font-size:.82rem}
.legend .key .chip{white-space:nowrap}
.legend .keys{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:6px 12px}
.index{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:18px 0}
.index .g{display:flex;gap:6px 8px;flex-wrap:wrap;align-items:center;margin:5px 0}
.index .g b{width:100%;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.index a{font:600 .78rem ui-monospace,Menlo,monospace;text-decoration:none;color:#0f172a;background:#eef2f7;border:1px solid var(--soft);border-radius:6px;padding:2px 7px}
.index a.need{background:#fff3d6;border-color:#f59e0b}
.index a.new{border-style:dashed;border-color:#64748b}
.index a:hover{outline:2px solid #93c5fd}
table.decisions{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
table.decisions th,table.decisions td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--soft);vertical-align:top;font-size:.9rem}
table.decisions th{background:#f1f5f9;font-size:.76rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.scn{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px 18px;margin:18px 0;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.scn.has-decision{border-color:#f59e0b;box-shadow:0 0 0 2px #fde7b6}
.scn header{display:flex;gap:8px 10px;align-items:center;flex-wrap:wrap}
.scn h3{margin:0;font-size:1.1rem;flex:1 1 18rem}
.id{font:700 .85rem ui-monospace,Menlo,monospace;background:#0f172a;color:#fff;border-radius:6px;padding:3px 8px}
.badge{font-size:.72rem;font-weight:700;border-radius:10px;padding:3px 9px}
.badge.need{background:#f59e0b;color:#fff}
.badge.cond{background:#e0e7ff;color:#3730a3}
.badge.new{background:#e2e8f0;color:#334155;border:1px dashed #64748b}
.tag{font-size:.68rem;font-weight:700;background:#e2e8f0;color:#334155;border-radius:8px;padding:1px 7px;margin-left:6px;white-space:nowrap}
.story{margin:8px 0 12px;color:var(--muted)}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
.board{display:grid;grid-template-columns:3.2rem repeat(var(--n),minmax(8.5rem,1fr));background:#fff;min-width:min-content}
.board>div{padding:6px 8px;border-bottom:1px solid var(--soft);min-width:0}
.corner{background:#f1f5f9}
.lane-head{font-weight:700;font-size:.8rem;color:#fff;text-align:center;padding:8px 6px!important;background:var(--c)}
.no{font:600 .7rem ui-monospace,Menlo,monospace;color:var(--muted);background:#f1f5f9;display:flex;align-items:flex-start;justify-content:center;padding-top:10px!important}
.no.end{color:var(--ok);background:var(--okbg);font-weight:800;border-top:2px solid #86efac}
.cell{background:var(--bg);border-left:1px solid var(--soft)}
.cell.off{background-image:repeating-linear-gradient(135deg,rgba(100,116,139,.17) 0 5px,transparent 5px 11px)}
.cell.end{background:var(--okbg);border-top:2px solid #86efac}
.cell.shared{--c:#475569;--bg:#f8fafc}
.l-tab{--c:#2563eb;--bg:#f3f7ff}.l-tab2{--c:#047857;--bg:#f1fbf6}.l-tab3{--c:#7c3aed;--bg:#f7f3ff}.l-tab4{--c:#db2777;--bg:#fff3f9}
.l-ai{--c:#111827;--bg:#f3f4f6}.l-server{--c:#b45309;--bg:#fff8ee}.l-record{--c:#0f766e;--bg:#effaf8}.l-store{--c:#0e7490;--bg:#eef9fc}.l-file{--c:#475569;--bg:#f4f6f9}
.pill{display:flex;gap:7px;align-items:flex-start;background:#fff;border:1px solid var(--c);border-left-width:4px;border-radius:8px;padding:5px 8px;font-size:.82rem;line-height:1.3;box-shadow:0 1px 1px rgba(15,23,42,.05)}
.pill .ic{flex:none;width:15px;height:15px;margin-top:1px;fill:none;stroke:var(--c);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.pill .ic .f{fill:var(--c);stroke:none}
.pill .ic .r{stroke:#dc2626}
.pill .to{display:block;margin-top:2px;font-size:.72rem;color:var(--c)}
.pill.k-fault,.pill.k-crash{border-color:#dc2626;background:#fff5f5;--c:#dc2626}
.pill.k-late,.pill.k-deadline{border-color:#d97706;background:#fffaf0;--c:#d97706}
.pill.k-offline{border-color:#64748b;background:#f1f5f9;--c:#64748b}
.pill.k-delete,.pill.k-remove{--c:#dc2626}
.strip{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.strip.small .chip{font-size:.68rem}
.chip{font:600 .7rem/1.2 ui-monospace,Menlo,monospace;padding:3px 6px;border-radius:5px;border:1px solid #94a3b8;background:#fff;color:#334155;word-break:break-word}
.chip small{font:inherit;font-weight:400;margin-left:5px;opacity:.9}
.chip.edited{background:#fffbe6;border-color:#ca8a04}
.chip.new{background:#ecfdf5;border-color:#059669}
.chip.gone{background:#fef2f2;border-color:#ef4444;color:#b91c1c;text-decoration:line-through}
.chip.moved{background:#eff6ff;border-color:#2563eb}
.chip.copy{background:#f5f3ff;border:1px dashed #7c3aed}
.chip.out{background:#f0f9ff;border-color:#0284c7;border-left-width:4px}
.chip.bad{background:#fef2f2;border:2px solid #dc2626;color:#991b1b}
.chip.remark{flex:0 0 100%;border:0;background:none;font:italic 400 .74rem/1.3 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--muted);padding:1px 0}
.result{display:flex;gap:10px;align-items:flex-start;margin-top:12px;background:var(--okbg);border:1px solid #86efac;border-radius:8px;padding:9px 12px}
.result b{flex:none;color:var(--ok)}
.result b::before{content:"✓ "}
.risk{margin:8px 2px 0;color:var(--muted);font-size:.88rem}
.risk b{color:#334155}
.decision{margin-top:12px;background:var(--warnbg);border:1px solid #f59e0b;border-radius:10px;padding:12px 14px}
.dhead{font-weight:800;color:var(--warn);text-transform:uppercase;font-size:.76rem;letter-spacing:.05em}
.question{margin:4px 0 10px;font-weight:600}
.options{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
.option{background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.option.proposed{border:2px solid #16a34a}
.option p{margin:4px 0 0;font-size:.88rem;color:var(--muted)}
.olabel{font-weight:700}
.flag{background:#16a34a;color:#fff;font-size:.68rem;border-radius:9px;padding:2px 8px;margin-right:7px;vertical-align:1px}
footer{margin-top:50px;color:var(--muted);font-size:.85rem}
.hidden{display:none!important}
@media (max-width:760px){nav.bar{position:static}.top h1{font-size:1.4rem}.wrap{padding:0 12px 60px}}
@media print{nav.bar{display:none}.scn{break-inside:avoid}.scroll{overflow:visible}}
"""

_JS = """
(function(){
  var cards=[].slice.call(document.querySelectorAll('.scn')),only=document.getElementById('only-open'),q=document.getElementById('q');
  function apply(){
    var t=(q.value||'').toLowerCase().trim();
    cards.forEach(function(c){
      var show=(!only.checked||c.classList.contains('has-decision'))&&(!t||c.textContent.toLowerCase().indexOf(t)>-1||c.id.toLowerCase()===t);
      c.classList.toggle('hidden',!show);
    });
    [].slice.call(document.querySelectorAll('section.group')).forEach(function(s){
      s.classList.toggle('hidden',!s.querySelector('.scn:not(.hidden)'));
    });
  }
  only.addEventListener('change',apply);q.addEventListener('input',apply);
})();
"""


def _legend() -> str:
    keys = "".join(
        f'<span class="key"><span class="pill k-{k}" style="--c:#475569;padding:3px 5px">{_icon(k)}</span>{_e(label)}</span>'
        for k, label in LEGEND_KINDS.items()
    )
    chips = "".join(
        f'<span class="key">{_chip(t)}{_e(label)}</span>'
        for t, label in (
            ("c0", "a cell"),
            ("c0=+typed", "a cell that was edited"),
            ("+new cell", "a cell that was added"),
            ("-c2", "a cell that was removed"),
            ("^c0", "a cell that was moved"),
            ("?c1=recovered", "a copy set aside for the user"),
        )
    )
    return (
        '<div class="legend">'
        "<div><h4>How to read a storyboard</h4>"
        "<p>Each column is someone or something: a tab, an AI agent, the server, the file. The steps happen in the order of their numbers. "
        "A hatched column means that tab is offline or gone. <b>c0, c1, c2</b> are the three cells of the notebook the stories start with, "
        "and the line of boxes under a step is what that column's copy of the notebook holds after it.</p>"
        f'<div class="keys">{keys}</div></div>'
        f'<div><h4>The cells</h4><div class="keys">{chips}</div>'
        '<p style="margin-top:10px">The last row, <b>end</b>, is what every copy must hold when the story is over.</p></div>'
        "</div>"
    )


def _index(spec: dict, suite) -> str:
    rows = []
    for gid in _group_order(spec, suite):
        links = "".join(
            f'<a href="#{_e(sid)}" class="{"need " if spec["scenarios"][sid].get("decision") else ""}{"new" if sid not in suite.scenarios else ""}" '
            f'title="{_e(spec["scenarios"][sid]["title"])}">{_e(sid)}</a>'
            for sid in _group_ids(spec, suite, gid)
        )
        if links:
            rows.append(f'<div class="g"><b>{_e(spec["groups"][gid]["title"])}</b>{links}</div>')
    return '<div class="index">' + "".join(rows) + "</div>"


def _decisions_table(spec: dict, suite) -> str:
    rows = []
    for gid in _group_order(spec, suite):
        for sid in _group_ids(spec, suite, gid):
            sb = spec["scenarios"][sid]
            if not sb.get("decision"):
                continue
            d = sb["decision"]
            proposed = next(o for o in d["options"] if o.get("proposed"))
            tag = "" if sid in suite.scenarios else f'<span class="tag">{_e(spec["page"]["unplayed"]["option_label"].lower())}</span>'
            rows.append(
                f'<tr><td><a href="#{_e(sid)}"><b>{_e(sid)}</b></a></td><td>{_e(sb["title"])}</td>'
                f'<td>{_e(d["question"])}</td><td>{_e(proposed["label"])}{tag}</td></tr>'
            )
    return (
        '<table class="decisions"><thead><tr><th>Story</th><th>Situation</th><th>The question</th><th>Proposed (or suggested) answer</th></tr></thead><tbody>'
        + "".join(rows)
        + "</tbody></table>"
    )


def render(spec: dict[str, Any], suite, *, complete: bool = True, only: tuple[str, ...] | None = None) -> str:
    """The whole page as one string. Deterministic: the same inputs give the same bytes.

    ``only`` is for the author of a storyboard: a page with just those stories, to see how they look.
    """
    check(spec, suite, complete=complete and not only)
    page = spec["page"]
    scenarios = spec["scenarios"]
    n_stories = len(scenarios)
    n_open = sum(1 for sb in scenarios.values() if sb.get("decision"))
    n_unplayed = sum(1 for sid in scenarios if sid not in suite.scenarios)
    if only:
        unknown = [sid for sid in only if sid not in scenarios]
        if unknown:
            raise StoryboardError(f"no storyboard for {unknown}")
        scenarios = {sid: sb for sid, sb in scenarios.items() if sid in only}
        spec = dict(spec, scenarios=scenarios)
    nav = "".join(
        f'<a href="#g-{_e(g)}">{_e(spec["groups"][g]["title"])}</a>'
        for g in _group_order(spec, suite)
        if _group_ids(spec, suite, g)
    )
    sections = []
    for gid in _group_order(spec, suite):
        sids = _group_ids(spec, suite, gid)
        if not sids:
            continue
        g = spec["groups"][gid]
        cards = "".join(_card(sid, scenarios[sid], suite.scenarios.get(sid), page) for sid in sids)
        sections.append(
            f'<section class="group" id="g-{_e(gid)}"><h2>{_e(g["title"])}</h2><p class="intro">{_e(g["intro"])}</p>{cards}</section>'
        )
    principles = "".join(f'<div><b>{_e(p["name"])}</b>{_e(p["text"])}</div>' for p in page["principles"])

    def counted(text: str) -> str:
        return _e(text.replace("{stories}", str(n_stories)).replace("{open}", str(n_open)).replace("{unplayed}", str(n_unplayed)))

    return (
        "<!doctype html>\n"
        '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{_e(page['title'])}</title><style>{_CSS}</style></head><body>"
        f'<div class="top"><div class="wrap"><h1>{_e(page["title"])}</h1><p>{counted(page["intro"])}</p></div></div>'
        f'<nav class="bar"><div class="wrap">{nav}'
        f'<label><input type="checkbox" id="only-open"> only the {n_open} that need alignment</label>'
        '<input type="search" id="q" placeholder="search, or a story id" aria-label="Search the stories"></div></nav>'
        '<div class="wrap">'
        + (
            ""
            if only
            else f'<div class="principles">{principles}</div>{_legend()}{_index(spec, suite)}'
            f'<h2 id="decisions">Where we need to align</h2><p class="intro">{counted(page["decisions_intro"])}</p>{_decisions_table(spec, suite)}'
        )
        + "".join(sections)
        + f"<footer>{counted(page['footer'])}</footer></div><script>{_JS}</script></body></html>\n"
    )


def render_page(suite) -> str:
    return render(load(), suite)


def main(argv: list[str] | None = None) -> int:
    """Write ``STORYBOARDS.html`` (the same as ``python -m jupyter_server_documents.tests.acceptance.render``)."""
    import argparse

    from . import suite as suite_mod

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--partial", action="store_true", help="draw the storyboards that exist, without requiring all of them (for writing new ones)")
    ap.add_argument("--only", nargs="+", metavar="ID", help="draw just these stories, to see how they look")
    ap.add_argument("-o", "--output", type=Path, default=STORYBOARDS_HTML)
    args = ap.parse_args(argv)
    suite = suite_mod.get()
    args.output.write_text(render(load(), suite, complete=not args.partial, only=tuple(args.only or ())))
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
