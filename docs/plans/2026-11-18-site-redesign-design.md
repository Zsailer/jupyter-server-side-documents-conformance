# Site redesign: a welcome page, the current state, what is up for discussion, and focused previews

## Why

The page was one dense list of 69 stories with filters and live players. A newcomer had nowhere gentle to start, nobody
could see at a glance how things work today, the open questions were mixed in with the settled ones, and a pull request
preview opened on the whole site even when it changed one story.

## Pages

| Page | What it is |
|---|---|
| `index.html` | A short welcome: the logo, what this is in two or three sentences, three links. Nothing else |
| `current.html` | Current state: one row per story, with what happens today and a tag: Settled, Provisional, No answer yet |
| `discussion.html` | Up for discussion: a small, opt-in list of questions with their competing answers and an optional link |
| `stories.html` | Every story with its live player (today's dense page, moved) |
| `about.html` | How to read a story (unchanged) |

The top bar shows the official Jupyter logo on every page. The sidebar toggle appears only on `stories.html`.

## Current state

Grouped as the page is today. Each row: id, title, one sentence on what happens today (the story's `result`; for an open
story, its provisional answer, the option marked `proposed`), a tag, and a link to the player. The tag is Settled, Provisional
(`best_effort` in the suite) or No answer yet (`pending`). A small filter by tag.

## Up for discussion

A story is listed when its YAML has a `discussion:` block, or when it is a proposed case (`status: proposed`):

```yaml
discussion:
  link: https://github.com/<owner>/<repo>/issues/12   # optional
  note: "Where the group stands."                      # optional
```

An entry shows the question (`decision.question`), the competing answers side by side (`decision.options`, today's marked),
the link, and a link to watch the story. A `discussion:` block is valid only on a story with alternatives or a proposed
case; the build says so otherwise. The 11 stories with an open decision get a block to start with.

## Previews of a pull request

`preview.yml` also checks out the base branch's `stories/`. The build compares stories by id and sorts them into New,
Changed and Removed (any difference counts: steps, result, alternatives, discussion). When there is any change, the
preview's `index.html` is "What this pull request changes": a banner, the player of each new or changed story, what moved
(which parts changed, the old and new result), and the title of any removed story. The welcome page is then
`welcome.html`, and the nav's Home link points there. With no story change the preview is the normal site. The main site
never has a changes page. A line-by-line YAML diff is left to GitHub.

## Out of scope

Screenshots, a diff of the YAML, and a way to edit stories from the site.
