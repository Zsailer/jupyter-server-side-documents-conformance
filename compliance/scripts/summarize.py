#!/usr/bin/env python3
"""Summarize a run of the compliance tests: one line per story, and what the open questions came out as.

    python3 -I compliance/scripts/summarize.py [test-results folder]

Reads what Playwright left in test-results/ (a folder per story that ran; an error-context.md in those that failed) and
stories.json (every story, and what it needs). A story with no folder was skipped.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
COMPLIANCE = HERE.parent
RESULTS = Path(sys.argv[1]) if len(sys.argv) > 1 else COMPLIANCE / "test-results"


def reason(folder: Path) -> str:
    text = (folder / "error-context.md").read_text(encoding="utf-8", errors="replace")
    m = re.search(r"# Error details\s+```\s*(.*?)```", text, re.S)
    body = (m.group(1) if m else "").strip()
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    if not lines:
        return "failed"
    first = re.sub(r"^Error:\s*", "", lines[0])
    if first.startswith("step ") and len(lines) > 1:  # "step 6. Tab B ..." then the reason
        second = re.sub(r"^Error:\s*", "", lines[1])
        first = f"{first} — {second}"
    return first[:150]


def main() -> None:
    stories = json.loads((COMPLIANCE / "stories.json").read_text())
    folders = {}
    for d in RESULTS.glob("*"):
        # a story writes its name in its folder (Playwright shortens a long title in the name of the folder)
        marker = d / "story.txt"
        if d.is_dir() and marker.is_file():
            folders[marker.read_text(encoding="utf-8").strip()] = d
        elif d.is_dir() and (m := re.match(r"generated-[a-z]+-([A-Z]+[0-9]*)-", d.name)):
            folders[m.group(1)] = d  # a run from before stories had names
    adapter_file = RESULTS / "adapter.json"
    has = set(json.loads(adapter_file.read_text())["capabilities"]) if adapter_file.exists() else None
    passed = failed = missed = 0
    skipped: dict[str, list[str]] = {}
    rows = []
    for s in stories:
        folder = folders.get(s["id"])
        if folder is None:
            missing = [r for r in s["requires"] if has is not None and r not in has]
            if s["internal"]:
                why = "not checkable from the user's side"
            elif has is not None and not missing:
                why = "not selected in this run"
            else:
                why = "needs " + ", ".join(missing or s["requires"])
            skipped.setdefault(why, []).append(s["id"])
            continue
        if (folder / "not-met.txt").exists():  # a proposed case the backend does not meet: reported, not failed
            missed += 1
            line = next((l for l in (folder / "not-met.txt").read_text().splitlines() if l.strip()), "")
            rows.append((s["id"], "miss", line.strip()[:150], s["needsAlignment"]))
        elif (folder / "error-context.md").exists():
            failed += 1
            rows.append((s["id"], "FAIL", reason(folder), s["needsAlignment"]))
        else:
            passed += 1
            rows.append((s["id"], "ok", "", s["needsAlignment"]))
    print(f"\n{len(stories)} stories: {passed} passed, {failed} failed, {missed} proposed cases not met, {sum(len(v) for v in skipped.values())} skipped\n")
    for sid, status, why, open_ in rows:
        print(f"  {sid:<42} {status:<4} {'?' if open_ else ' '} {why}")
    print("\n  ? = the storyboard still asks a question about this one")
    if missed:
        print("  miss = a proposed case this backend does not meet yet (reported, not failed)")
    print("\nSkipped:")
    for why, ids in sorted(skipped.items(), key=lambda kv: -len(kv[1])):
        print(f"  {len(ids):>2}  {why}: {', '.join(ids)}")
    probe = RESULTS / "probe.txt"
    if probe.exists():
        print("\nProbe:")
        for line in probe.read_text().splitlines():
            print("  " + line)
    notes = RESULTS / "notes.jsonl"
    if notes.exists():
        print("\nWhat a person would have noticed:")
        for line in notes.read_text().splitlines():
            r = json.loads(line)
            print(f"  {r['id']:<42} {r['note']}")
    verdicts = RESULTS / "implements.jsonl"
    if verdicts.exists():
        print("\nOpen questions in the storyboards, and what this backend does:")
        for line in verdicts.read_text().splitlines():
            r = json.loads(line)
            print(f"  {r['id']:<4} {r['title']}")
            for v in r["verdict"]:
                print(f"         {v}")


if __name__ == "__main__":
    main()
