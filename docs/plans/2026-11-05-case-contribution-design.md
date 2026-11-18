# How a case gets contributed

Date: 2026-11-05. Status: part 1 built; parts 2 and 3 to come.

## The goal

Someone drafts a pull request that is only about the user experience of one case. The page, the animation and the
compliance test all come from it. People discuss the case on the pull request, looking at a live preview of it.

## Decisions

- **Who writes a case:** people comfortable editing a YAML file in a pull request, usually with their agent.
- **Where cases live:** `stories/`. It is the one place to edit. Everything else is generated and not committed:
  `compliance/tests/generated/`, `compliance/stories.json`, `compliance/COVERAGE.md`, the built page.
- **Who builds the preview:** CI publishes a preview of every pull request and links it in a comment. (This design first had the author's agent build and link one by hand.)
- **Two kinds of fact, kept apart:**
  - a case's `status` (`proposed` or `accepted`, default `accepted`) is about agreement. It lives in the story file.
    A proposed case is played and tested, and a backend that misses it is reported, not failed. Reviewers change it to
    `accepted` in the same pull request once the group agrees.
  - a backend's known gaps (`compliance/known-gaps/<adapter>.json`) are about a backend. A listed accepted case runs
    and is expected to fail (`test.fail`), so a run stays green while the gap is open and turns red the day it closes.

  Mixing them would make a contributor's pull request depend on whether one backend passes.
- **Pull requests merge into `main`.** Cases the suite already knows (`stories/suite.yaml`) keep its policy; a story
  without an entry in it is simply appended to its group.

## Parts

1. **Stories are the home** (this change): `stories/`, `status`, known gaps, generated files not committed,
   `npm run check`.
2. **A preview of the pull request:** validate, build and publish it from CI.
3. **Writing it down for agents and people:** a skill, `.claude/skills/write-a-case`, a pull request template, and
   `CONTRIBUTING.md`.

## Not decided

- Whether `suite.yaml` (vendored from jupyter-server-documents) should eventually fold into the story files.
- Where a published results snapshot for a backend should live next to the page.
