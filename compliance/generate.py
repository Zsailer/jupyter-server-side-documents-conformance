#!/usr/bin/env python3
"""Generate the compliance tests from the storyboards.

    python3 -I compliance/generate.py                 # writes compliance/tests/generated/*.spec.ts, stories.json, COVERAGE.md
    python3 -I compliance/generate.py --check         # fail if the files on disk are not what the stories give

Each story of the storyboards becomes one Galata test. The test does what the story's steps say (a person types,
a tab goes offline, the server lets go of the notebook, the file changes from outside) and, at the end, checks what
every copy of the notebook holds. It knows nothing of how any backend does it: what a backend must be able to do to
run a story is listed in the story's `requires`, and the backend's adapter says which of those it can.

The words of the storyboards are the source of truth. Where the cells of a story need more than the storyboard says to
become a check (a merge whose result is described, not written), `oracle.yaml` says it, and the story is reported as
checked loosely until it does.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "examples" / "storyboards"))
import build as storyboards  # noqa: E402
import nbscenario_spec as spec  # noqa: E402

DATA = ROOT / "stories"
OUT = HERE / "tests" / "generated"

#: things a person does with their hands: the test does them with real keystrokes
USER_KINDS = {"type", "add", "delete", "move", "run"}
#: notes that rewrite a cell: its whole source becomes the note
REWRITE_NOTES = {"EDITED OFFLINE", "EDITED ON DISK", "EXTERNAL EDIT", "fixed"}
#: notes that only describe a cell
ANNOTATIONS = {"1 output", "once", "recovered", "link", "second copy", "ADDED ON DISK"}
#: kinds that need the backend to do something
DESTRUCTIVE = {"crash", "outside", "remove", "restore", "fault", "late"}


def ts(value) -> str:
    return json.dumps(value, ensure_ascii=False)


# ---------------------------------------------------------------------------------------------------------------------
# cells
# ---------------------------------------------------------------------------------------------------------------------
@dataclass
class Cell:
    """A cell of a storyboard, as far as a test needs to know it."""

    key: str  # what the storyboard calls it
    look: str  # plain | new | gone | moved | copy | out | bad | edited
    base: str  # what it starts as
    typed: list[str] = field(default_factory=list)  # pieces typed at its end, each as the storyboard writes them ("+B-TYPED")
    rewrite: str | None = None  # what it was rewritten as
    #: how it must read: ("exact", text) | ("parts", base, [parts]) | ("contains", [parts]) | None (not a cell to check)
    expect: tuple | None = None

    @property
    def text(self) -> str:
        """The source the cell has, if it has one that is exactly known; else what it starts as."""
        return (self.rewrite if self.rewrite is not None else self.base) + "".join(" " + t for t in self.typed)


def split_typed(note: str) -> list[str]:
    return [p.strip() for p in re.split(r"\s+(?=\+)", note) if p.strip()]


def make_cell(token: str, oracle: dict, loose: list[str], expect_bad: bool = False) -> Cell | None:
    mark, name, note = spec.parse_cell(token)
    if mark == "*":
        return None
    typed: list[str] = []
    base = name
    m = re.match(r"^(\S+) (\+.+)$", name)  # "c1 +B-TYPED": a copy of c1 with typing in it
    if m:
        base, typed = m.group(1), split_typed(m.group(2))
    rewrite = None
    unknown = False
    if note:
        if note.startswith("+"):
            typed += split_typed(note)
        else:
            left, _, right = note.partition(" + ")
            if left in REWRITE_NOTES:
                rewrite = left
                typed += split_typed("+" + right) if right else []
            elif " = " in note:
                rewrite = note  # the note is the new code
            elif note not in ANNOTATIONS:
                unknown = True
    look = {"": "plain", "+": "new", "-": "gone", "^": "moved", "?": "copy", "#": "out", "!": "bad"}[mark]
    if look == "plain" and note:
        look = "edited"
    cell = Cell(key=base, look=look, base=base, typed=typed, rewrite=rewrite)
    over = oracle.get(token)
    if mark == "-" or (mark == "!" and not expect_bad):
        cell.expect = None  # gone, or must not happen: the exact list at the end is what rules it out
    elif over:
        if "contains" in over:
            cell.expect = ("contains", list(over["contains"]))
        elif "exact" in over:
            cell.expect = ("exact", over["exact"])
        elif over.get("skip"):
            cell.expect = None
    elif mark == "?":
        cell.expect = ("contains", [rewrite or base] + typed)
    elif len(typed) > 1:
        cell.expect = ("parts", rewrite or base, typed)
    else:
        cell.expect = ("exact", cell.text)
    if unknown and not over:
        loose.append(f"{token}: the note “{note}” is not something a check can be made from")
    return cell


def model(tokens, oracle: dict, loose: list[str], expect_bad: bool = False) -> list[Cell]:
    if isinstance(tokens, str):
        return []
    return [c for c in (make_cell(t, oracle, loose, expect_bad) for t in tokens) if c is not None]


def ts_expect(e: tuple) -> str:
    if e[0] == "exact":
        return ts(e[1])
    if e[0] == "parts":
        return "E.parts(" + ", ".join(ts(x) for x in [e[1]] + e[2]) + ")"
    return "E.contains(" + ", ".join(ts(x) for x in e[1]) + ")"


def expects(cells: list[Cell]) -> list[tuple]:
    return [c.expect for c in cells if c.expect is not None and c.look != "gone"]


def ts_list(cells: list[Cell]) -> str:
    return "[" + ", ".join(ts_expect(e) for e in expects(cells)) + "]"


def exact_list(cells: list[Cell]) -> bool:
    """Whether every cell of the list can be checked exactly (so the list is worth checking at a step)."""
    return all(c.expect is not None and c.expect[0] == "exact" for c in cells if c.look not in ("gone", "bad"))


# ---------------------------------------------------------------------------------------------------------------------
# what a person does to turn one list of cells into another
# ---------------------------------------------------------------------------------------------------------------------
def ops_for(prev: list[Cell], new: list[Cell]) -> list[tuple]:
    """The edits that turn `prev` into `new`: ('delete', i) ('add', i, text) ('move', from, to) ('type', i, text) ('rewrite', i, text)."""
    cur = list(prev)
    ops: list[tuple] = []
    keep = {c.key for c in new if c.look != "gone"}
    for i in range(len(cur) - 1, -1, -1):
        if cur[i].key not in keep:
            ops.append(("delete", i))
            cur.pop(i)
    target = [c for c in new if c.look != "gone"]
    # a cell the story says was moved is the one that moves, to where it ends up among the cells that were already there
    present = {p.key for p in cur}
    among = [c for c in target if c.key in present]
    for c in target:
        if c.look == "moved" and c.key in present:
            j = next(k for k, p in enumerate(cur) if p.key == c.key)
            i = among.index(c)
            if j != i:
                ops.append(("move", j, i))
                cur.insert(i, cur.pop(j))
    for i, c in enumerate(target):
        at = next((j for j, p in enumerate(cur) if p.key == c.key), None)
        if at is None:
            ops.append(("add", i, c.text))
            cur.insert(i, c)
            continue
        if at != i:
            ops.append(("move", at, i))
            cur.insert(i, cur.pop(at))
        p = cur[i]
        if p.text != c.text:
            grew = c.rewrite == p.rewrite and c.typed[: len(p.typed)] == p.typed and len(c.typed) > len(p.typed)
            if grew:
                ops.append(("type", i, "".join(" " + t for t in c.typed[len(p.typed):])))
            else:
                ops.append(("rewrite", i, c.text))
        cur[i] = c
    return ops


# ---------------------------------------------------------------------------------------------------------------------
# a story
# ---------------------------------------------------------------------------------------------------------------------
def lanes_of(step: dict) -> list[str]:
    at = step["at"]
    return list(at) if isinstance(at, list) else [at]


def family(lane: str) -> str:
    return "tab" if re.fullmatch(r"tab\d*", lane) else lane


class Compiled:
    def __init__(self, sid: str):
        self.sid = sid
        self.lines: list[str] = []
        self.requires: set[str] = set()
        self.loose: list[str] = []
        self.ordered = True
        self.tabs: list[str] = []
        self.internal: str | None = None


def compile_story(sid: str, st: dict, features: list[str], oracle: dict) -> Compiled:
    out = Compiled(sid)
    cell_oracle = (oracle.get("cells") or {}).get(sid) or {}
    out.internal = (oracle.get("internal") or {}).get(sid)
    if (oracle.get("ordered") or {}).get(sid) is False:
        out.ordered = False
    titles = {**spec.LANES, **(st.get("lanes") or {})}
    drawn = spec.drawn_lanes(st)
    start = st.get("start") or {"file": ["c0", "c1", "c2"]}
    file_tokens = start.get("file") if isinstance(start.get("file"), list) else ["c0", "c1", "c2"]
    no_ids = any(isinstance(t, str) and t.startswith("*") and "no cell ids" in t for t in file_tokens)
    known: dict[str, list[Cell]] = {"file": model(file_tokens, cell_oracle, out.loose)}
    state: dict[str, str] = {}
    steps = st["steps"]

    for lane in drawn:
        if family(lane) == "tab":
            out.tabs.append(lane)
    for step in steps:
        for lane in lanes_of(step) + ([step["to"]] if step.get("to") else []):
            if family(lane) == "tab" and lane not in out.tabs:
                out.tabs.append(lane)
    if any(family(lane) in ("record", "store") for lane in drawn):
        out.requires.add("historyRecord")
    for f in features:
        out.requires.add("historyRecord")

    sources = [c.text for c in known["file"]]
    out.lines.append(f"await s.notebook({ts(sources)}{', { ids: false }' if no_ids else ''});")
    for lane in out.tabs:
        out.lines.append(f"const {lane} = s.tab({ts(lane)});")
    out.lines.append("")

    # "B closes its tab" ... "B comes back": the tab that comes back is the one that went away, so it stays open, offline
    comes_back: set[tuple[str, int]] = set()
    for i, step in enumerate(steps, 1):
        if step["kind"] == "leave":
            for lane in lanes_of(step):
                for later in steps[i:]:
                    if lane in lanes_of(later) and later["kind"] == "open":
                        break
                    if lane in lanes_of(later) and later["kind"] == "reconnect":
                        comes_back.add((lane, i))
                        break

    released = False
    crashed = False
    for n, step in enumerate(steps, 1):
        kind = step["kind"]
        body: list[str] = []
        who = " + ".join(titles[lane] for lane in lanes_of(step))
        new_cells = model(step["cells"], cell_oracle, out.loose) if isinstance(step.get("cells"), list) else None
        remark = step.get("cells") if isinstance(step.get("cells"), str) else None
        for lane in lanes_of(step):
            fam = family(lane)
            if fam == "tab":
                tab_body, state_after = tab_step(lane, kind, new_cells, known, state, out, (lane, n) in comes_back, step, steps[n:], cell_oracle)
                body += tab_body
                state[lane] = state_after
                if kind == "reconnect":
                    released = False
                if kind == "open":
                    released = False
            elif fam == "server":
                if kind in ("rebuild", "free"):
                    if crashed:
                        out.requires.add("crashServer")
                        body.append("await s.restartServer();")
                        crashed = False
                        released = False
                    elif not released:
                        out.requires.add("releaseRoom")
                        body.append("await s.releaseRoom();")
                        released = True
                elif kind == "crash":
                    out.requires.add("crashServer")
                    body.append("await s.crashServer();")
                    crashed = True
                elif kind in ("deadline", "fault", "late"):
                    out.requires.add("wireFaults")
                    body.append(f"// {step['text']}: the backend's adapter causes this")
                if new_cells is not None:
                    known["server"] = new_cells
            elif fam == "file":
                if kind in ("outside", "restore"):
                    out.requires.add("fileSystem")
                    cells = new_cells if new_cells is not None else known.get("file", [])
                    body.append(f"await s.writeFileOutside({ts([c.text for c in cells if c.look != 'gone'])}{', { ids: false }' if no_ids else ''});")
                elif kind == "remove":
                    out.requires.add("fileSystem")
                    body.append("await s.removeFileOutside();")
                elif kind == "save" and new_cells is not None and exact_list(new_cells) and any(
                    later["kind"] in DESTRUCTIVE for later in steps[n:]
                ):
                    body.append(f"await s.expectFile({ts_list(new_cells)});")
                if new_cells is not None:
                    known["file"] = new_cells
            elif fam == "ai":
                out.requires.add("agent")
                after = next((model(later["cells"], cell_oracle, out.loose) for later in steps[n:] if isinstance(later.get("cells"), list) and family(lanes_of(later)[0]) in ("server", "file")), [])
                body.append(f"await s.agent({ts(step['text'])}, {ts([c.text for c in after if c.look != 'gone'])});")
            else:  # record, store
                out.requires.add("historyRecord")
                body.append(f"// {step['text']}")
        if kind in ("fault", "late") and family(lanes_of(step)[0]) == "tab":
            out.requires.add("wireFaults")
            tab = lanes_of(step)[0]
            body.append(f"await s.wireFault({ts('lose-reply' if kind == 'fault' else 'late-reply')}, {tab});")
        if kind == "deadline" and family(lanes_of(step)[0]) == "tab":
            out.requires.add("wireFaults")
        if remark:
            body.append(f"// {remark}")
        if not body:
            body.append("// nothing for a test to do: the storyboard states what is so")
        out.lines.append(f"await s.step({n}, {ts(who)}, {ts(step['text'])}, async () => {{")
        out.lines += ["  " + line for line in body]
        out.lines.append("});")

    # the end
    end_lanes = ends_lanes(st, drawn, state, server_holds=not (released or crashed))
    # every ending the story allows, the proposed one first; a list of cells means every copy ends like that
    endings: list[tuple[str, dict, bool]] = [("As the story ends", st["ends"], False)]
    if st.get("decision"):
        proposed = [o for o in st["decision"]["options"] if o.get("proposed")][0]
        others = [o for o in st["decision"]["options"] if not o.get("proposed") and "ends" in o]
        endings = [(proposed["label"], proposed.get("ends", st["ends"]), False)] + [(o["label"], o["ends"], True) for o in others]
    blocks = []
    for label, ends, alternative in endings:
        opt = ends if isinstance(ends, dict) else {"all": ends}
        per_lane = []
        for lane in end_lanes:
            tokens = opt.get(lane, opt.get("all"))
            if tokens is None:
                continue
            cells = model(tokens, cell_oracle, out.loose, expect_bad=alternative)
            if isinstance(tokens, list) and any(isinstance(t, str) and t.startswith("*") and "one of" in t for t in tokens):
                out.ordered = False
            per_lane.append(f"{lane}: {ts_list(cells)}")
        blocks.append("{ label: " + ts(label) + ", ends: { " + ", ".join(per_lane) + " } }")
    out.lines.append("")
    out.lines.append("await s.ends([")
    out.lines += [f"  {b}," for b in blocks]
    out.lines.append("]);")
    return out


def tab_step(lane: str, kind: str, new: list[Cell] | None, known: dict, state: dict, out: Compiled, stays_open: bool = False, step: dict | None = None, later: list | None = None, oracle: dict | None = None) -> tuple[list[str], str]:
    """The lines that make a tab do a step, and the state it is in after."""
    body: list[str] = []
    cur = state.get(lane, "new")
    if kind == "open":
        body.append(f"await {lane}.open();")
        known[lane] = new if new is not None else list(known.get("file", []))
        if exact_list(known[lane]):
            body.append(f"await s.expectTab({lane}, {ts_list(known[lane])});")
        return body, "online"
    if kind == "offline":
        body.append(f"await {lane}.goOffline();")
        return body, "offline"
    if kind == "reconnect":
        body.append(f"await {lane}.goOnline();")
        if new is not None:
            known[lane] = new
        return body, "online"
    if kind == "leave":
        if stays_open:
            body.append(f"await {lane}.goOffline(); // it goes away and, later in the story, comes back: the tab stays open")
            return body, "offline"
        body.append(f"await {lane}.close();")
        return body, "closed"
    if kind == "add" and new is None and step is not None:
        quoted = re.findall(r"“([^”]+)”", step["text"])
        have = {c.key for c in known.get(lane, [])}
        for name in quoted:
            if name in have:
                continue
            at = len(known.get(lane, []))
            for nxt in later or []:
                if isinstance(nxt.get("cells"), list):
                    names = [c.key for c in model(nxt["cells"], oracle or {}, []) if c.look != "gone"]
                    if name in names:
                        at = names.index(name)
                        break
            body.append(f"await {lane}.addCell({at}, {ts(name)});")
            known[lane] = list(known.get(lane, []))
            known[lane].insert(min(at, len(known[lane])), Cell(key=name, look="new", base=name, expect=("exact", name)))
        if body and cur == "online":
            body.append(f"await s.settle({lane});")
        return body, cur
    if kind in USER_KINDS and new is not None:
        ops = ops_for(known.get(lane, []), new)
        for op in ops:
            body.append(op_line(lane, op))
        known[lane] = new
        if ops and cur == "online":
            body.append(f"await s.settle({lane});")
        if ops and exact_list(new):
            body.append(f"await s.expectTab({lane}, {ts_list(new)});")
        return body, cur
    if kind in ("note", "late", "fault", "deadline") and new is not None:
        known[lane] = new
        if kind == "note" and exact_list(new):
            body.append(f"await s.expectTabEventually({lane}, {ts_list(new)});")
    return body, cur


def op_line(tab: str, op: tuple) -> str:
    if op[0] == "delete":
        return f"await {tab}.deleteCell({op[1]});"
    if op[0] == "add":
        return f"await {tab}.addCell({op[1]}, {ts(op[2])});"
    if op[0] == "move":
        return f"await {tab}.moveCell({op[1]}, {op[2]});"
    if op[0] == "type":
        return f"await {tab}.type({op[1]}, {ts(op[2])});"
    return f"await {tab}.rewrite({op[1]}, {ts(op[2])});"


def ends_lanes(st: dict, drawn: list[str], state: dict, server_holds: bool = True) -> list[str]:
    """The lanes whose copy is checked at the end: the ones the story names, or every lane that holds a copy."""
    named = [lane for lane in st["ends"] if lane != "all"]
    lanes = [lane for lane in drawn if family(lane) in ("tab", "server", "file")]
    if "all" in st["ends"]:
        chosen = lanes
    else:
        chosen = [lane for lane in lanes if lane in named]
    return [
        lane
        for lane in chosen
        if (family(lane) != "tab" or state.get(lane) in ("online", "offline")) and (lane != "server" or server_holds)
    ]


# ---------------------------------------------------------------------------------------------------------------------
# the files
# ---------------------------------------------------------------------------------------------------------------------
HEADER = """\
// GENERATED by compliance/generate.py from the storyboards. Do not edit: change the storyboard, or oracle.yaml, and generate again.
import { test } from '@jupyterlab/galata';
import { E, story } from '../../runtime/story';
"""


def emit_story(sid: str, st: dict, group: str, scn: dict, page: dict, c: Compiled) -> str:
    needs = bool(st.get("decision"))
    features = list(scn.get("requires") or [])
    meta = {
        "id": sid,
        "group": group,
        "title": st["title"],
        "requires": sorted(c.requires),
    }
    if st.get("aliases"):
        meta["aliases"] = list(st["aliases"])
    if needs:
        meta["needsAlignment"] = True
    if st.get("status") == "proposed":
        meta["proposed"] = True
    if features:
        meta["appliesIf"] = features
    if not c.ordered:
        meta["ordered"] = False
    if c.loose:
        meta["loose"] = c.loose
    if c.internal:
        meta["internal"] = c.internal
    body = "\n".join("      " + line if line else "" for line in c.lines)
    head = "\n".join("      " + line for line in json.dumps(meta, indent=2, ensure_ascii=False).splitlines())
    words = " ".join(st["story"].split())
    return f"// {words}\ntest(\n  ...story(\n{head},\n    async s => {{\n{body}\n    }}\n  )\n);\n"


def generate(data: Path = DATA) -> dict:
    src = storyboards.load(data)
    taken: dict[str, str] = {}
    for sid, st in src["stories"].items():
        spec.validate_story(sid, st)
        # a name, or a name a story had before, stands for one story only
        for name in [sid, *(st.get("aliases") or [])]:
            if name in taken:
                raise SystemExit(f"{name!r} names both {taken[name]!r} and {sid!r}")
            taken[name] = sid
    oracle = yaml.safe_load((HERE / "oracle.yaml").read_text()) or {}
    files: dict[str, str] = {}
    manifest = []
    # Stories that kill the server go to serial.spec.ts: they run alone, after the others (playwright.config.ts)
    parts: dict[str, list[str]] = {}
    for gid in storyboards.group_order(src):
        for sid in storyboards.stories_of(src, gid):
            st = src["stories"][sid]
            scn = (src["suite"].get("scenarios") or {}).get(sid) or {}
            c = compile_story(sid, st, list(scn.get("requires") or []), oracle)
            name = "serial.spec.ts" if "crashServer" in c.requires else f"{gid}.spec.ts"
            parts.setdefault(name, [HEADER]).append(emit_story(sid, st, gid, scn, src["page"], c))
            manifest.append({
                "id": sid,
                "group": gid,
                "groupTitle": src["groups"][gid]["title"],
                "title": st["title"],
                "aliases": list(st.get("aliases") or []),
                "requires": sorted(c.requires),
                "needsAlignment": bool(st.get("decision")),
                "proposed": st.get("status") == "proposed",
                "loose": c.loose,
                "internal": c.internal,
                "steps": len(st["steps"]),
            })
    files.update({name: "\n".join(texts) for name, texts in parts.items()})
    return {"files": files, "manifest": manifest, "groups": {g: src["groups"][g]["title"] for g in storyboards.group_order(src)}}


def coverage(manifest: list[dict], groups: dict) -> str:
    total = len(manifest)
    by_need: dict[tuple, list[str]] = {}
    for m in manifest:
        by_need.setdefault(tuple(m["requires"]), []).append(m["id"])
    lines = [
        "# What the compliance tests need from a backend",
        "",
        "<!-- GENERATED by compliance/generate.py. Do not edit. -->",
        "",
        f"{total} stories. A story runs when the backend's adapter can do everything in its **needs**; otherwise it is skipped, and the report says what was missing.",
        "",
        "| needs | stories | ids |",
        "|---|---:|---|",
    ]
    for needs, ids in sorted(by_need.items(), key=lambda kv: (len(kv[0]), kv[0])):
        lines.append(f"| {', '.join(needs) or '_nothing beyond a plain JupyterLab_'} | {len(ids)} | {', '.join(ids)} |")
    capabilities = sorted({c for m in manifest for c in m["requires"]})
    lines += ["", "## Each capability", "", "| capability | stories that need it |", "|---|---:|"]
    for cap in capabilities:
        lines.append(f"| {cap} | {sum(1 for m in manifest if cap in m['requires'])} |")
    lines += ["", "## Checked loosely", "", "Stories where the storyboard describes a result in words that a check cannot be made from. Give `oracle.yaml` an entry to make them exact.", ""]
    loose = [m for m in manifest if m["loose"]]
    if loose:
        for m in loose:
            lines.append(f"- **{m['id']}**: " + "; ".join(m["loose"]))
    else:
        lines.append("_none_")
    lines += ["", "## Not checkable from the user's side", "", "These describe something inside the server that a person cannot cause or see. They are generated, and skipped with the reason.", ""]
    internal = [m for m in manifest if m["internal"]]
    for m in internal:
        lines.append(f"- **{m['id']}**: {m['internal']}")
    if not internal:
        lines.append("_none_")
    lines += ["", "## Stories that are still open questions", "", "The proposed answer is held to, unless `COMPLIANCE_DECISIONS` picks another.", ""]
    lines.append(", ".join(m["id"] for m in manifest if m["needsAlignment"]))
    lines.append("")
    return "\n".join(lines)


def write(result: dict, check: bool) -> list[str]:
    wanted = {OUT / name: text for name, text in result["files"].items()}
    wanted[HERE / "stories.json"] = json.dumps(result["manifest"], indent=1, ensure_ascii=False) + "\n"
    wanted[HERE / "COVERAGE.md"] = coverage(result["manifest"], result["groups"])
    stale = []
    for path, text in wanted.items():
        if check:
            if not path.exists() or path.read_text() != text:
                stale.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
    if not check:
        for old in OUT.glob("*.spec.ts"):
            if old not in wanted:
                old.unlink()
    return stale


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--check", action="store_true", help="fail if the files on disk are out of date")
    args = ap.parse_args()
    result = generate(args.data)
    stale = write(result, args.check)
    if args.check and stale:
        sys.exit("out of date (run python3 -I compliance/generate.py): " + ", ".join(stale))
    n = len(result["manifest"])
    runnable = sum(1 for m in result["manifest"] if not m["requires"])
    print(f"{n} stories in {len(result['files'])} files; {runnable} need nothing beyond a plain JupyterLab")


if __name__ == "__main__":
    main()
