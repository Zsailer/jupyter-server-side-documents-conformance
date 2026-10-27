"""What a run of the acceptance suite reports: one `Entry` per scenario, shown on the terminal, written as JSON and as Markdown.

The entries are plain data. They are meant to be read by a person qualifying a change ("what does this PR do to the
matrix?") and by a program (the JSON), so they say, for every scenario, what was expected, what was observed, and the
words to explain the difference.
"""
from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict, dataclass, field

#: outcome -> (symbol for the terminal, meaning)
OUTCOMES = {
    "pass": ("ok", "met the reference, as expected"),
    "gap": ("gap", "a known gap, as expected: the story ends short of the reference"),
    "pending": ("?", "the policy is pending: reported, not enforced"),
    "n/a": ("n/a", "needs a feature this tree does not have"),
    "improvement": ("BETTER", "better than expected: update suite.yaml"),
    "regression": ("WORSE", "worse than expected"),
    "error": ("ERROR", "the scenario raised before it ended"),
}


@dataclass
class Entry:
    id: str
    group: str
    title: str
    says: str
    expected: str  # a level, or "n/a"
    observed: str  # a level, or "-" if it was not played
    outcome: str  # a key of OUTCOMES
    summary: str  # one line: what it ended with
    why: str = ""  # the reason of the expectation, when it is not the reference
    seconds: float = 0.0
    problems: list[str] = field(default_factory=list)  # which clauses fail
    pending_question: str = ""
    steps: list[str] = field(default_factory=list)  # the timeline, kept for what went wrong
    verdict: dict = field(default_factory=dict)
    policy: str = "decided"  # decided, best_effort (a provisional answer) or pending

    @property
    def bad(self) -> bool:
        return self.outcome in ("regression", "improvement", "error")


def counts(entries: list[Entry]) -> Counter:
    return Counter(e.outcome for e in entries)


def split(entries: list[Entry]) -> tuple[list[Entry], list[Entry], list[Entry]]:
    """The scenarios that end as they should, the ones that do not, and the ones that cannot be played on this tree."""
    played = [e for e in entries if e.outcome != "n/a"]
    return (
        [e for e in played if e.observed == "reference"],
        [e for e in played if e.observed != "reference"],
        [e for e in entries if e.outcome == "n/a"],
    )


#: the ways a scenario can fall short of the reference, in the order the scoreboard lists them:
#: (outcome, in a table cell, in the scoreboard)
SHORT_OF_THE_REFERENCE = (
    ("gap", "known gap", "known gaps, recorded in suite.yaml"),
    ("pending", "policy pending", "pending a policy decision"),
    ("improvement", "better than suite.yaml expects", "better than suite.yaml expects, still short of the reference"),
    ("regression", "WORSE than suite.yaml expects", "WORSE than suite.yaml expects"),
    ("error", "raised before it ended", "raised before they ended"),
)


@dataclass(frozen=True)
class Scoreboard:
    """What a reader needs first, in the words to show.

    Two questions are answered apart, because a green run answers only the second. *Does the tree do what it should?* is the
    headline and the details. *Did the change make anything worse than suite.yaml expects of this kind of tree?* is the last line,
    and it is all the exit status says.
    """

    headline: str  # how many scenarios end as they should
    details: list[str]  # which do not, and which cannot be played: one line each
    against_suite: str  # regressions and improvements, relative to suite.yaml
    caveat: str  # said only when some scenario does not end as it should
    all_fine: bool


def scoreboard(entries: list[Entry], profile: str, features: set[str]) -> Scoreboard:
    fine, short, absent = split(entries)
    played = len(fine) + len(short)
    where = f"a tree of kind '{profile}' (features: {', '.join(sorted(features)) or 'none'})"
    if not played:
        headline = f"No scenario can be played on {where}."
    elif not short:
        headline = f"All {played} scenarios that can be played on {where} end as they should."
    else:
        headline = (
            f"{len(fine)} of the {played} scenarios that can be played on {where} end as they should; "
            f"{len(short)} {'does' if len(short) == 1 else 'do'} not."
        )
    details = []
    for outcome, _, label in SHORT_OF_THE_REFERENCE:
        ids = [e.id for e in short if e.outcome == outcome]
        if ids:
            details.append(f"{len(ids)} {label}: {' '.join(ids)}")
    provisional = [e.id for e in fine if e.policy == "best_effort"]
    if provisional:
        details.append(
            f"{len(provisional)} of the {len(fine)} that end as they should do so under a best-effort answer, not yet confirmed: {' '.join(provisional)}"
        )
    unanswered = [e.id for e in fine if e.policy == "pending"]
    if unanswered:
        details.append(
            f"{len(unanswered)} of the {len(fine)} that end as they should do so under a suggestion nobody has answered yet: {' '.join(unanswered)}"
        )
    if absent:
        needs = "; ".join(sorted({e.why for e in absent if e.why}))
        details.append(f"{len(absent)} cannot be played on this tree{f' ({needs})' if needs else ''}: {' '.join(e.id for e in absent)}")
    c = counts(entries)
    return Scoreboard(
        headline,
        details,
        f"Against what suite.yaml expects of this kind of tree: {c['regression'] + c['error']} regressions, {c['improvement']} improvements.",
        "That judges the change, not the tree: a run without a regression still has the scenarios above that do not end as they should." if short else "",
        all_fine=bool(played) and not short,
    )


def terminal_lines(entries: list[Entry], profile: str, features: set[str], titles: dict[str, str]) -> list[tuple[str, dict]]:
    """The matrix and the scoreboard as (text, terminal markup) pairs."""
    rows = [("id", "group", "expected", "observed", "result", "what it ended with")]
    for e in entries:
        rows.append((e.id, e.group, e.expected, e.observed, OUTCOMES[e.outcome][0], e.summary.replace("**", "")))
    widths = [max(len(r[i]) for r in rows) for i in range(5)]
    out: list[tuple[str, dict]] = [("", {}), ("Acceptance matrix", {}), ("=" * 17, {})]
    for r in rows:
        out.append(("  ".join(r[i].ljust(widths[i]) for i in range(5)) + "  " + r[5], {}))
    board = scoreboard(entries, profile, features)
    out += [("", {}), (board.headline, {"green": True, "bold": True} if board.all_fine else {"red": True, "bold": True})]
    out += [("  " + line, {"yellow": True}) for line in board.details]
    out.append((board.against_suite, {}))
    if board.caveat:
        out.append((board.caveat, {}))
    for kind in ("regression", "error", "improvement"):
        bad = [e for e in entries if e.outcome == kind]
        if bad:
            out.append((f"{OUTCOMES[kind][0]}: " + ", ".join(e.id for e in bad) + f"  ({OUTCOMES[kind][1]})", {"red": True, "bold": True}))
    return out


def to_json(entries: list[Entry], profile: str, features: set[str], meta: dict) -> str:
    c = counts(entries)
    fine, short, absent = split(entries)
    return json.dumps(
        {
            "profile": profile,
            "features": sorted(features),
            **meta,
            "summary": {k: c[k] for k in OUTCOMES}
            | {
                "scenarios": len(entries),
                "playable": len(fine) + len(short),
                "end_as_they_should": len(fine),
                "do_not_end_as_they_should": len(short),
            },
            "scenarios": [asdict(e) for e in entries],
        },
        indent=1,
        sort_keys=False,
    ) + "\n"


def markdown(entries: list[Entry], profile: str, features: set[str], meta: dict) -> str:
    board = scoreboard(entries, profile, features)
    _, short, _ = split(entries)
    lines = [
        "# Acceptance matrix",
        "",
        f"Kind of tree: **{profile}** (features: {', '.join(sorted(features)) or 'none'}). " + " ".join(f"{k}: {v}." for k, v in meta.items()),
        "",
        f"**{board.headline}**",
        "",
    ]
    if board.details:
        lines += [f"- {line}" for line in board.details] + [""]
    lines += [" ".join(part for part in (board.against_suite, board.caveat) if part), ""]
    for kind, heading in (("regression", "Regressions"), ("error", "Errors"), ("improvement", "Improvements (update suite.yaml)")):
        hit = [e for e in entries if e.outcome == kind]
        if hit:
            lines += [f"## {heading}", ""]
            for e in hit:
                lines.append(f"- **{e.id}** {e.title}: expected {e.expected}, observed {e.observed}. {e.summary}")
                lines += [f"  - {p}" for p in e.problems[:6]]
            lines.append("")
    if short:
        label_of = {outcome: cell for outcome, cell, _ in SHORT_OF_THE_REFERENCE}
        lines += [f"## Scenarios that do not end as they should ({len(short)})", "", "| ID | What it ended with | Why |", "|---|---|---|"]
        for e in short:
            reason = " ".join((e.why or e.pending_question or "").split())
            lines.append(f"| {e.id} | {e.summary} | {label_of[e.outcome]}{': ' + reason if reason else ''} |")
        lines.append("")
    lines += ["## All scenarios", "", "| ID | Group | Expected | Observed | Result | What it ended with |", "|---|---|---|---|---|---|"]
    for e in entries:
        lines.append(f"| {e.id} | {e.group} | {e.expected} | {e.observed} | {OUTCOMES[e.outcome][0]} | {e.summary} |")
    return "\n".join(lines) + "\n"
