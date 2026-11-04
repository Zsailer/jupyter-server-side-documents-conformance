#!/usr/bin/env python3
"""Build the storyboards page: every story of the storyboard files as a live, side-by-side notebook demo.

    python3 -I examples/storyboards/build.py                 # writes examples/storyboards/site/index.html
    python3 -I examples/storyboards/build.py --data DIR -o out.html

DIR holds page.yaml and one <group>.yaml per group of stories (the layout of `storyboards/` in
jupyter-server-documents), plus an optional suite.yaml that says which stories are still open questions.
The page is one self-contained file: no network, no build step, host it as it is.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import nbscenario_spec as spec  # noqa: E402

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
        return [sid for sid, s in suite.items() if s.get("group") == gid and sid in src["stories"]]
    return [sid for sid, s in src["stories"].items() if s["group"] == gid]


def answer_label(src: dict, sid: str, played: bool) -> str:
    """"Suggested" for an answer nobody has discussed, "Proposed" for one that was taken for now."""
    scn = (src["suite"].get("scenarios") or {}).get(sid)
    pending = scn is not None and (scn.get("policy") or {}).get("status") == "pending"
    return SUGGESTED if (not played or pending) else PROPOSED


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


def build(data: Path, out: Path) -> dict:
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

    nav, body = [], []
    open_ids = [sid for g in order for sid in stories_of(src, g) if all_stories[sid].get("decision")]
    for gid in order:
        g = src["groups"][gid]
        ids = stories_of(src, gid)
        nav.append(
            f'<div class="nav-group" data-group="{e(gid)}"><a class="nav-gtitle" href="#g-{e(gid)}">{e(g["title"])}</a>'
            + "".join(
                f'<a class="nav-story{" need" if all_stories[s].get("decision") else ""}" data-id="{e(s)}" href="#{e(s)}"><span class="nav-id">{e(s)}</span>{e(all_stories[s]["title"])}</a>'
                for s in ids
            )
            + "</div>"
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
        f'<a href="#{e(s)}"><span class="nav-id">{e(s)}</span>{e(all_stories[s]["title"])}</a>' for s in open_ids
    )
    template = (HERE / "template.html").read_text()
    data_json = json.dumps({"stories": all_stories, "config": config}, ensure_ascii=False).replace("</", "<\\/")
    html_out = (
        template.replace("{{TITLE}}", e(page["title"]))
        .replace("{{HEADING}}", e(page["title"]))
        .replace("{{INTRO}}", e(fill(page["intro"])))
        .replace("{{PRINCIPLES}}", principles)
        .replace("{{DECISIONS_INTRO}}", e(fill(page["decisions_intro"])))
        .replace("{{NEED_LIST}}", need_list)
        .replace("{{NEED_COUNT}}", str(counts["open"]))
        .replace("{{STORY_COUNT}}", str(counts["stories"]))
        .replace("{{NAV}}", "".join(nav))
        .replace("{{BODY}}", "".join(body))
        .replace("{{FEATURE_FILTERS}}", "".join(
            f'<button type="button" class="chip-filter" data-filter="feature:{e(k)}">{e(v["badge"])}</button>'
            for k, v in page["applies_if"].items()
        ))
        .replace("{{DATA}}", data_json)
        .replace("{{PLAYER_CSS}}", (ROOT / "player" / "nbscenario.css").read_text())
        .replace("{{PAGE_CSS}}", (HERE / "page.css").read_text())
        .replace("{{PLAYER_JS}}", (ROOT / "player" / "nbscenario.js").read_text().replace("</script", "<\\/script"))
        .replace("{{PAGE_JS}}", (HERE / "page.js").read_text())
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html_out)
    return {"stories": all_stories, "counts": counts, "groups": order}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=HERE / "data")
    ap.add_argument("-o", "--out", type=Path, default=HERE / "site" / "index.html")
    args = ap.parse_args()
    result = build(args.data, args.out)
    print(f"{args.out}: {result['counts']['stories']} stories in {len(result['groups'])} groups ({result['counts']['open']} need alignment)")


if __name__ == "__main__":
    main()
