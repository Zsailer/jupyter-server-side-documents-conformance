#!/usr/bin/env python3
"""Build the storyboards page: every story of the storyboard files as a live, side-by-side notebook demo.

    python3 -I examples/storyboards/build.py                 # writes the pages to examples/storyboards/site/
    python3 -I examples/storyboards/build.py --data DIR -o out/

DIR holds page.yaml and one <group>.yaml per group of stories (the layout of `storyboards/` in
jupyter-server-documents), plus an optional suite.yaml that says which stories are still open questions.
Each page is one self-contained file: no network, no build step, host the folder as it is.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import nbscenario_spec as spec  # noqa: E402

def _logo() -> str:
    """The Jupyter mark (jupyter-logo.svg, from JupyterLab's @jupyterlab/ui-components, BSD-3-Clause), inline and sized."""
    svg = (HERE / "jupyter-logo.svg").read_text()
    svg = re.sub(r'width="39" height="51"', 'width="22" height="29" aria-hidden="true" class="logo"', svg, count=1)
    return svg.replace("#616161", "#767677").replace("\n", "")


LOGO = _logo()
THEME_CONTROL = (
    '<div class="theme" role="group" aria-label="Theme">'
    '<button type="button" data-theme-set="auto" aria-pressed="false">Auto</button>'
    '<button type="button" data-theme-set="light" aria-pressed="false">Light</button>'
    '<button type="button" data-theme-set="dark" aria-pressed="false">Dark</button></div>'
)

# the pages of the site, in the order of the top bar: (file, label)
NAV = [
    ("current.html", "Current state"),
    ("discussion.html", "Up for discussion"),
    ("stories.html", "All stories"),
    ("about.html", "How to read these"),
]
REPO = "https://github.com/Zsailer/jupyter-server-side-documents-conformance"

SETTLED, PROVISIONAL, OPEN = "settled", "provisional", "open"
STATUS_TEXT = {SETTLED: "Settled", PROVISIONAL: "Provisional", OPEN: "No answer yet"}
STATUS_HELP = {
    SETTLED: "The group agrees on this.",
    PROVISIONAL: "An answer taken for now, open to change.",
    OPEN: "Nobody has answered this yet; the answer shown is a suggestion.",
}


def topbar(active: str, home: str = "index.html", side_toggle: bool = False, extra: tuple[str, str] | None = None) -> str:
    """The bar at the top of every page. `active` is the file of the page being shown."""
    toggle = (
        '<button type="button" class="side-toggle" id="sideToggle" aria-expanded="true" aria-controls="side" '
        'aria-label="Show or hide the list of stories" title="Show or hide the list of stories">'
        '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg></button>'
        if side_toggle
        else ""
    )
    current = ' aria-current="page"'
    pages = ([extra] if extra else []) + NAV
    links = "".join(f'<a href="{href}"{current if href == active else ""}>{label}</a>' for href, label in pages)
    return (
        f'<header class="topbar">{toggle}'
        f'<a class="brand" href="{home}" aria-label="Server Side Document Conformance Storybook, home">{LOGO}'
        '<span class="brand-name">Jupyter</span><span class="brand-sep">/</span><span class="brand-page">Server Side Document Conformance Storybook</span></a>'
        f'<nav class="topnav" aria-label="Pages">{links}</nav>{THEME_CONTROL}</header>'
    )


PROPOSED = "Proposed"
SUGGESTED = "Suggested"


def load(data: Path) -> dict:
    """{"page", "groups", "stories": {id: story}, "suite"} from a directory of storyboard files."""
    boards = data / "storyboards" if (data / "storyboards").is_dir() else data
    page = yaml.safe_load((boards / "page.yaml").read_text())
    stories: dict[str, dict] = {}
    for path in sorted(boards.glob("*.yaml")):
        if path.name == "page.yaml":
            continue
        body = yaml.safe_load(path.read_text()) or {}
        unknown = set(body) - {"scenarios", "shared"}
        if unknown:
            raise spec.SpecError(f"{path.name}: unknown key(s) {sorted(unknown)}")
        for sid, story in (body.get("scenarios") or {}).items():
            if sid in stories:
                raise spec.SpecError(f"story {sid} is in two files")
            stories[sid] = dict(story, group=path.stem)
    suite_path = data / "suite.yaml"
    suite = yaml.safe_load(suite_path.read_text()) if suite_path.exists() else {"groups": {}, "scenarios": {}}
    return {"page": page["page"], "groups": page["groups"], "stories": stories, "suite": suite}


def group_order(src: dict) -> list[str]:
    """The groups of the suite, then the ones it does not play."""
    suite_groups = list((src["suite"].get("groups") or {}))
    return [g for g in suite_groups if g in src["groups"]] + [g for g in src["groups"] if g not in suite_groups]


def stories_of(src: dict, gid: str) -> list[str]:
    """The stories of a group, in the suite's order where the suite has the group, else the file's."""
    suite = src["suite"].get("scenarios") or {}
    if gid in (src["suite"].get("groups") or {}):
        listed = [sid for sid, s in suite.items() if s.get("group") == gid and sid in src["stories"]]
        # a story added to the file without an entry in the suite follows the ones the suite orders
        return listed + [sid for sid, s in src["stories"].items() if s["group"] == gid and sid not in suite]
    return [sid for sid, s in src["stories"].items() if s["group"] == gid]


def answer_label(src: dict, sid: str, played: bool) -> str:
    """"Suggested" for an answer nobody has discussed, "Proposed" for one that was taken for now."""
    scn = (src["suite"].get("scenarios") or {}).get(sid)
    pending = scn is not None and (scn.get("policy") or {}).get("status") == "pending"
    return SUGGESTED if (not played or pending) else PROPOSED


FIELD_NAMES = {
    "title": "the title", "story": "the description", "lanes": "the windows", "start": "the start", "steps": "the steps",
    "result": "what the product does", "ends": "how it ends", "risk": "the risk", "decision": "the alternatives",
    "discussion": "the discussion", "status": "its status", "group": "its group", "badges": "the badges",
}


def diff_stories(base: dict, head: dict) -> dict:
    """What a change did to the stories, by id: {"new": [...], "changed": {id: [fields]}, "removed": [...]}."""

    def same(a, b) -> bool:
        return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)

    changed = {}
    for sid in head.keys() & base.keys():
        fields = sorted(k for k in head[sid].keys() | base[sid].keys() if not same(head[sid].get(k), base[sid].get(k)))
        if fields:
            changed[sid] = fields
    return {"new": sorted(head.keys() - base.keys()), "changed": dict(sorted(changed.items())), "removed": sorted(base.keys() - head.keys())}


def changes_page(change: dict, base_src: dict, all_stories: dict, number: str | None) -> str:
    """The content of "what this pull request changes": the new and changed stories to watch, and what moved."""
    who = f"pull request #{e(number)}" if number else "this change"
    total = len(change["new"]) + len(change["changed"]) + len(change["removed"])
    parts = []
    for sid in change["new"]:
        parts.append(
            f'<section class="change"><header><span class="tag tag-new">New</span><span class="state-id">{e(sid)}</span>'
            f'<h2>{e(all_stories[sid]["title"])}</h2></header>'
            f'<article class="story-card" id="{e(sid)}" data-nbs>{static_card(all_stories[sid])}</article></section>'
        )
    for sid, fields in change["changed"].items():
        old = base_src["stories"][sid]
        now = all_stories[sid]
        moved = ", ".join(FIELD_NAMES.get(f, f) for f in fields)
        before_after = ""
        if "result" in fields:
            before_after = (
                f'<div class="change-diff"><div><b>Before</b><p>{e(old["result"])}</p></div>'
                f'<div><b>After</b><p>{e(now["result"])}</p></div></div>'
            )
        parts.append(
            f'<section class="change"><header><span class="tag tag-provisional">Changed</span><span class="state-id">{e(sid)}</span>'
            f'<h2>{e(now["title"])}</h2></header><p class="change-what">What changed: {e(moved)}.</p>{before_after}'
            f'<article class="story-card" id="{e(sid)}" data-nbs>{static_card(now)}</article></section>'
        )
    for sid in change["removed"]:
        old = base_src["stories"][sid]
        parts.append(
            f'<section class="change"><header><span class="tag">Removed</span><span class="state-id">{e(sid)}</span>'
            f'<h2>{e(old["title"])}</h2></header><p class="change-what">It said: {e(old["result"])}</p></section>'
        )
    banner = (
        f'<p class="preview-banner">A preview of {who}. This page shows only what changed; '
        '<a href="welcome.html">the whole site</a> is here too: '
        '<a href="current.html">current state</a>, <a href="discussion.html">up for discussion</a>, <a href="stories.html">all stories</a>.</p>'
    )
    return (
        f'{banner}<section class="hero"><h1>What this changes</h1>'
        f'<p class="lead">{total} {"story" if total == 1 else "stories"}: '
        f'{len(change["new"])} new, {len(change["changed"])} changed, {len(change["removed"])} removed.</p></section>{"".join(parts)}'
    )


def status_of(src: dict, sid: str) -> str:
    """Settled, provisional (a best-effort answer taken for now) or open (a suggestion nobody has answered)."""
    if not src["stories"][sid].get("decision"):
        return SETTLED
    scn = (src["suite"].get("scenarios") or {}).get(sid) or {}
    return OPEN if (scn.get("policy") or {}).get("status") == "pending" else PROVISIONAL


def discussed(story: dict) -> bool:
    """A story is up for discussion when it opts in, and a proposed case always is."""
    return bool(story.get("discussion")) or story.get("status") == "proposed"


def current_page(src: dict, order: list[str], all_stories: dict) -> str:
    """The "current state" content: one row per story, what happens today, and how firm that answer is."""
    counts = {k: 0 for k in STATUS_TEXT}
    sections = []
    for gid in order:
        rows = []
        for sid in stories_of(src, gid):
            st = all_stories[sid]
            status = status_of(src, sid)
            counts[status] += 1
            rows.append(
                f'<li><details class="state-row" id="{e(sid)}" data-status="{status}"><summary>'
                f'<span class="state-id">{e(sid)}</span>'
                f'<span class="state-main"><b class="state-title">{e(st["title"])}</b><span class="state-result">{e(st["result"])}</span></span>'
                f'<span class="tag tag-{status}" title="{e(STATUS_HELP[status])}">{STATUS_TEXT[status]}</span></summary>'
                f'<div class="state-demo"><article class="story-card" data-story="{e(sid)}" data-nbs>{static_card(st)}</article>'
                f'<p class="state-more"><a href="stories.html#{e(sid)}">Open it among all the stories</a></p></div></details></li>'
            )
        sections.append(
            f'<section class="state-group" id="g-{e(gid)}"><h2>{e(src["groups"][gid]["title"])}</h2><ul class="state-list">{"".join(rows)}</ul></section>'
        )
    chips = "".join(
        f'<button type="button" class="chip-filter{" on" if key == "all" else ""}" data-filter="{key}" aria-pressed="{str(key == "all").lower()}">{label}</button>'
        for key, label in [("all", f"All ({sum(counts.values())})")]
        + [(k, f"{STATUS_TEXT[k]} ({counts[k]})") for k in (SETTLED, PROVISIONAL, OPEN) if counts[k]]
    )
    return (
        '<section class="hero"><h1>How it works today</h1>'
        '<p class="lead">For each story, what happens now. Click one to watch it play. Most are settled. The rest are an answer '
        'taken for now, or a suggestion nobody has answered yet; <a href="discussion.html">they are open for discussion</a>.</p></section>'
        f'<div class="filters" id="filters">{chips}</div>{"".join(sections)}'
    )


def discussion_page(src: dict, order: list[str], all_stories: dict) -> str:
    """The "up for discussion" content: the questions the group has not settled, with the answers side by side."""
    ids = [sid for g in order for sid in stories_of(src, g) if discussed(src["stories"][sid])]
    cards = []
    for sid in ids:
        st = all_stories[sid]
        talk = st.get("discussion")
        talk = talk if isinstance(talk, dict) else {}
        decision = st.get("decision")
        # the player shows the competing answers, with the ending of each; a proposed case has only its result
        question = decision["question"] if decision else st["story"]
        links = ""
        if talk.get("link"):
            links += f'<a class="talk-join" href="{e(talk["link"])}" rel="noopener">Join the discussion</a>'
        links += f'<a href="stories.html#{e(sid)}">Open it among all the stories</a>'
        note = f'<p class="talk-note">{e(talk["note"])}</p>' if talk.get("note") else ""
        cards.append(
            f'<article class="talk" id="d-{e(sid)}"><header><span class="state-id">{e(sid)}</span><h3>{e(st["title"])}</h3></header>'
            f'<p class="talk-question">{e(question)}</p>'
            f'<div class="talk-demo"><article class="story-card" data-story="{e(sid)}" data-nbs>{static_card(st)}</article></div>'
            f'{note}<p class="talk-links">{links}</p></article>'
        )
    body = "".join(cards) or '<p class="empty">Nothing is up for discussion right now.</p>'
    return (
        '<section class="hero"><h1>Up for discussion</h1>'
        '<p class="lead">Questions the group has not settled. Each one plays, with the answers people are weighing below it and the one '
        'taken for now marked. Watch it, then add your view where the discussion is linked.</p>'
        f'<p class="hero-links">To suggest a change or a new case, see <a href="{REPO}/blob/main/CONTRIBUTING.md">how to contribute</a>.</p></section>'
        f'{body}'
    )


def story_json(src: dict, sid: str) -> dict:
    story = dict(src["stories"][sid])
    gid = story.pop("group")
    page = src["page"]
    played = src["groups"][gid].get("played") is not False
    scn = (src["suite"].get("scenarios") or {}).get(sid) or {}
    badges = []
    if story.get("decision"):
        badges.append({"text": "Needs alignment", "tone": "need"})
        story["decision"] = dict(story["decision"], answerLabel=answer_label(src, sid, played))
    if story.get("status") == "proposed":
        badges.append({"text": "Proposed case", "tone": "new", "title": "This case is up for discussion; nothing is held to it yet."})
    if not played:
        badges.append({"text": page["unplayed"]["badge"], "tone": "new", "title": page["unplayed"]["text"]})
    for feature in sorted(scn.get("requires") or []):
        info = page["applies_if"][feature]
        badges.append({"text": info["badge"], "tone": "info", "title": info["text"], "feature": feature})
    story["badges"] = badges
    story["id"] = sid
    story["group"] = gid
    return story


def e(text) -> str:
    return html.escape(str(text), quote=True)


def static_card(st: dict) -> str:
    """What a reader sees without JavaScript: the story as text. The player replaces it."""
    titles = {**spec.LANES, **(st.get("lanes") or {})}
    steps = "".join(
        f"<li><b>{e(' + '.join(titles[l] for l in (s['at'] if isinstance(s['at'], list) else [s['at']])))}</b> {e(s['text'])}</li>"
        for s in st["steps"]
    )
    return (
        f'<header class="nbs-head"><span class="nbs-id">{e(st["id"])}</span><h3>{e(st["title"])}</h3></header>'
        f'<p class="nbs-story">{e(st["story"])}</p><ol>{steps}</ol>'
        f'<div class="nbs-result"><b>What the product does</b><span>{e(st["result"])}</span></div>'
    )


def build(data: Path, out_dir: Path, base_data: Path | None = None, pr: str | None = None) -> dict:
    src = load(data)
    for sid, story in src["stories"].items():
        spec.validate_story(sid, story)
    page = src["page"]
    order = group_order(src)
    counts = {
        "stories": len(src["stories"]),
        "open": sum(1 for s in src["stories"].values() if s.get("decision")),
        "unplayed": sum(len(stories_of(src, g)) for g in order if src["groups"][g].get("played") is False),
    }

    def fill(text: str) -> str:
        for k, v in counts.items():
            text = text.replace("{" + k + "}", str(v))
        return " ".join(text.split())

    cells_path = HERE / "cells.yaml"
    config = yaml.safe_load(cells_path.read_text()) if cells_path.exists() else {}
    all_stories = {sid: story_json(src, sid) for sid in src["stories"]}

    # a preview of a pull request opens on what the pull request changes; the welcome page then moves to welcome.html
    change = base_src = None
    if base_data is not None and ((base_data / "page.yaml").exists() or (base_data / "storyboards" / "page.yaml").exists()):
        base_src = load(base_data)
        change = diff_stories(base_src["stories"], src["stories"])
        if not (change["new"] or change["changed"] or change["removed"]):
            change = None
    home = "welcome.html" if change else "index.html"
    extra = ("index.html", "This change") if change else None

    nav, body = [], []
    open_ids = [sid for g in order for sid in stories_of(src, g) if all_stories[sid].get("decision")]
    for gid in order:
        g = src["groups"][gid]
        ids = stories_of(src, gid)
        nav.append(
            f'<div class="nav-group" data-group="{e(gid)}"><div class="nav-ghead">'
            f'<button type="button" class="nav-chev" aria-expanded="true" aria-label="Fold {e(g["title"])}"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>'
            f'<a class="nav-gtitle" href="#g-{e(gid)}">{e(g["title"])}</a><span class="nav-gcount">{len(ids)}</span></div>'
            '<div class="nav-stories">'
            + "".join(
                f'<a class="nav-story{" need" if all_stories[s].get("decision") else ""}" data-id="{e(s)}" href="#{e(s)}"><span class="nav-id">{e(s)}</span>{e(all_stories[s]["title"])}</a>'
                for s in ids
            )
            + "</div></div>"
        )
        cards = "".join(
            f'<article class="story-card{" has-decision" if all_stories[s].get("decision") else ""}" id="{e(s)}" data-search="{e(" ".join([s, all_stories[s]["title"], all_stories[s]["story"], all_stories[s]["result"]]).lower())}" data-need="{int(bool(all_stories[s].get("decision")))}" data-features="{e(" ".join(b["feature"] for b in all_stories[s]["badges"] if b.get("feature")))}" data-nbs>{static_card(all_stories[s])}</article>'
            for s in ids
        )
        body.append(
            f'<section class="group" id="g-{e(gid)}" data-group="{e(gid)}"><h2>{e(g["title"])}</h2><p class="group-intro">{e(fill(g["intro"]))}</p>{cards}</section>'
        )

    principles = "".join(f'<div class="principle"><h3>{e(p["name"])}</h3><p>{e(fill(p["text"]))}</p></div>' for p in page["principles"])
    need_list = "".join(
        f'<a href="stories.html#{e(s)}"><span class="nav-id">{e(s)}</span>{e(all_stories[s]["title"])}</a>' for s in open_ids
    )
    data_json = json.dumps({"stories": all_stories, "config": config}, ensure_ascii=False).replace("</", "<\\/")
    shared = {
        "{{THEME_CONTROL}}": THEME_CONTROL,
        "{{NEED_COUNT}}": str(counts["open"]),
        "{{STORY_COUNT}}": str(counts["stories"]),
    }
    assets = {
        "{{DATA}}": data_json,
        "{{PLAYER_CSS}}": (ROOT / "player" / "nbscenario.css").read_text(),
        "{{PAGE_CSS}}": (HERE / "page.css").read_text(),
        "{{PLAYER_JS}}": (ROOT / "player" / "nbscenario.js").read_text().replace("</script", "<\\/script"),
        "{{THEME_JS}}": (HERE / "theme.js").read_text(),
        "{{PAGE_JS}}": (HERE / "page.js").read_text(),
        "{{ABOUT_JS}}": (HERE / "about.js").read_text(),
        "{{LIST_JS}}": (HERE / "list.js").read_text(),
        "{{DEMO_JS}}": (HERE / "demo.js").read_text(),
        "{{CHANGES_JS}}": (HERE / "changes.js").read_text(),
    }

    def render(template: str, content: dict) -> str:
        text = (HERE / template).read_text()
        for key, value in {**shared, **content}.items():
            text = text.replace(key, value)
        for key, value in assets.items():  # last: the scripts must not be searched for placeholders
            text = text.replace(key, value)
        return text

    stories_page = render("template.html", {
        "{{TOPBAR}}": topbar("stories.html", home, side_toggle=True, extra=extra),
        "{{TITLE}}": e(page["title"]),
        "{{HEADING}}": e(page["title"]),
        "{{INTRO}}": e(fill(page["intro"])),
        "{{NAV}}": "".join(nav),
        "{{BODY}}": "".join(body),
        "{{FEATURE_FILTERS}}": "".join(
            f'<button type="button" class="chip-filter" data-filter="feature:{e(k)}">{e(v["badge"])}</button>'
            for k, v in page["applies_if"].items()
        ),
    })
    about = render("about.template.html", {
        "{{TOPBAR}}": topbar("about.html", home, extra=extra),
        "{{INTRO}}": e(fill(page["intro"])),
        "{{PRINCIPLES}}": principles,
        "{{DECISIONS_INTRO}}": e(fill(page["decisions_intro"])),
        "{{NEED_LIST}}": need_list,
    })
    out_dir.mkdir(parents=True, exist_ok=True)
    welcome = render("welcome.template.html", {
        "{{TOPBAR}}": topbar("welcome.html" if change else "index.html", home, extra=extra),
        "{{DISCUSSED_COUNT}}": str(sum(1 for s in src["stories"].values() if discussed(s))),
    })
    for name, title, content in (
        ("current.html", "How it works today", current_page(src, order, all_stories)),
        ("discussion.html", "Up for discussion", discussion_page(src, order, all_stories)),
    ):
        (out_dir / name).write_text(render("doc.template.html", {
            "{{TITLE}}": title, "{{TOPBAR}}": topbar(name, home, extra=extra), "{{CONTENT}}": content,
            "{{PLAYER}}": '<script id="data" type="application/json">{{DATA}}</script><script>{{PLAYER_JS}}</script><script>{{DEMO_JS}}</script>',
        }))
    (out_dir / home).write_text(welcome)
    if change:
        shown = {sid: all_stories[sid] for sid in change["new"] + list(change["changed"])}
        changes_data = json.dumps({"stories": shown, "config": config}, ensure_ascii=False).replace("</", "<\\/")
        page_html = render("changes.template.html", {
            "{{TOPBAR}}": topbar("index.html", home, extra=extra),
            "{{CONTENT}}": changes_page(change, base_src, all_stories, pr),
            "{{CHANGES_DATA}}": changes_data,
        })
        (out_dir / "index.html").write_text(page_html)
    (out_dir / "stories.html").write_text(stories_page)
    (out_dir / "about.html").write_text(about)
    return {"stories": all_stories, "counts": counts, "groups": order}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=ROOT / "stories")
    ap.add_argument("--base-data", type=Path, help="the stories to compare with: the preview then opens on what changed")
    ap.add_argument("--pr", help="the number of the pull request, for the banner of the preview")
    ap.add_argument("-o", "--out", type=Path, default=HERE / "site", help="the folder the pages are written to")
    args = ap.parse_args()
    result = build(args.data, args.out, base_data=args.base_data, pr=args.pr)
    print(f"{args.out}: {result['counts']['stories']} stories in {len(result['groups'])} groups ({result['counts']['open']} need alignment)")


if __name__ == "__main__":
    main()
