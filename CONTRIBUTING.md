# Contributing a case

A case is one user-experience story: what people see when something happens to a shared notebook. You write it as a
few lines of YAML in `stories/storyboards/`. The page, the animation and the compliance tests come from it, so the pull
request can be about the experience and nothing else.

The quickest way is to ask your agent: this repo has a skill, `write-a-case`, that drafts the story, checks it and
previews it. To do it by hand:

1. Add your story to the closest group file in `stories/storyboards/`, with `status: proposed`. The grammar is in
   [`docs/02-spec-reference.md`](docs/02-spec-reference.md); how to design a good one is in
   [`docs/03-designing-a-good-scenario.md`](docs/03-designing-a-good-scenario.md).
2. `npm run check` validates it and runs the tests of the tooling.
3. `npm run build` builds the page; open `examples/storyboards/site/index.html`.
4. Open a draft pull request against `main` from your fork and put the link in it.

Discuss the case on the pull request, looking at the preview. When the group agrees, change the story to
`status: accepted`, in the same pull request. From then on a backend that does not do what it says fails its compliance
test, unless the gap is listed in `compliance/known-gaps/<adapter>.json`.

Nothing you write names an implementation. If the case needs the backend to do something to get set up (let go of a
notebook, crash), say it in the steps; the adapter for each backend says whether it can.

