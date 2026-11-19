# Contributing a case

A case is one user-experience story: what people see when something happens to a shared notebook. You write it as a
few lines of YAML in `stories/storyboards/`. The page, the animation and the compliance tests come from it, so the pull
request can be about the experience and nothing else.

The quickest way to change a story is on the page itself: every story has an "Edit this story on GitHub" link, which opens
its file in GitHub's editor and offers to open the pull request for you. Every page also has an "Edit this page on GitHub"
link at the bottom.

To draft a new case, ask your agent: this repo has a skill, `write-a-case`, that drafts the story, checks it and
previews it. To do it by hand:

1. Add your story to the closest group file in `stories/storyboards/`, with `status: proposed`. The grammar is in
   [`docs/02-spec-reference.md`](docs/02-spec-reference.md); how to design a good one is in
   [`docs/03-designing-a-good-scenario.md`](docs/03-designing-a-good-scenario.md).
2. `npm run check` validates it and runs the tests of the tooling.
3. `npm run build` builds the page; open `examples/storyboards/site/index.html` to look at it.
4. Open a draft pull request against `main`. A preview of the page is published and linked on the pull request.

To ask the group about it, add `discussion:` to the story (see [the spec](docs/02-spec-reference.md#putting-a-story-up-for-discussion)):
it is then listed on the "Up for discussion" page, with a link to the issue or pull request where you talk about it.

Discuss the case on the pull request, looking at the preview. When the group agrees, change the story to
`status: accepted`, in the same pull request. From then on a backend that does not do what it says fails its compliance
test, unless the gap is listed in `compliance/known-gaps/<adapter>.json`.

Nothing you write names an implementation. If the case needs the backend to do something to get set up (let go of a
notebook, crash), say it in the steps; the adapter for each backend says whether it can.

## Previews of pull requests

`.github/workflows/preview.yml` builds the page for every pull request and publishes it to GitHub Pages under
`pr-preview/pr-<number>/`, with a comment on the pull request that links it. When the pull request adds, changes or removes a
story, the link opens on a page that shows only that: the new and changed stories played, and what moved. The whole site is
in the same preview, one click away. A pull request that changes no story opens on the ordinary welcome page. The preview is updated on every push and
removed when the pull request is closed. The live page of `main` is published by `.github/workflows/pages.yml`.

Pull requests from a fork get no preview, because GitHub gives them a read-only token. The build and the tests still run
(`.github/workflows/ci.yml`); a maintainer can push the branch to this repository to get a preview.

Set up once by a maintainer: in Settings > Pages, publish from the `gh-pages` branch (root). The workflows create the branch.
