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
        m = re.match(r"generated-[a-z]+-([A-Z]+[0-9]*)-", d.name)
        if d.is_dir() and m:
            folders[m.group(1)] = d
    passed = failed = 0
    skipped: dict[str, list[str]] = {}
    rows = []
    for s in stories:
        folder = folders.get(s["id"])
        if folder is None:
            why = "not checkable from the user's side" if s["internal"] else "needs " + ", ".join(s["requires"])
            skipped.setdefault(why, []).append(s["id"])
            continue
        if (folder / "error-context.md").exists():
            failed += 1
            rows.append((s["id"], "FAIL", reason(folder), s["needsAlignment"]))
        else:
            passed += 1
            rows.append((s["id"], "ok", "", s["needsAlignment"]))
    print(f"\n{len(stories)} stories: {passed} passed, {failed} failed, {sum(len(v) for v in skipped.values())} skipped\n")
    for sid, status, why, open_ in rows:
        print(f"  {sid:<4} {status:<4} {'?' if open_ else ' '} {why}")
    print("\n  ? = the storyboard still asks a question about this one")
    print("\nSkipped:")
    for why, ids in sorted(skipped.items(), key=lambda kv: -len(kv[1])):
        print(f"  {len(ids):>2}  {why}: {', '.join(ids)}")
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
