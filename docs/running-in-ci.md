# Running the conformance tests in another repo's CI

The tests are published to npm as `@zsailer/jupyter-server-side-documents-conformance`, with a
`jupyter conformance ssd` command (see [running against a backend](running-against-a-backend.md)). A backend's workflow runs a
pinned version. It takes new cases when it bumps the version, so a case accepted here cannot turn its CI red by surprise.

## A workflow for a backend

Start it as a manual workflow (`workflow_dispatch`) and make it run on pull requests only once its results can be trusted.

```yaml
name: Conformance
on: workflow_dispatch

jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pip install -e ".[test]" jupyterlab   # your backend, installed into the Python that runs the server
      - name: Run the conformance tests
        env:
          VERSION: 0.0.5   # the version of the conformance tests this tree is held to
        run: npx --yes "@zsailer/jupyter-server-side-documents-conformance@$VERSION" ssd run
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: conformance-results
          path: conformance-results
```

The command finds the Python environment (the `python3` on the `PATH` has your backend installed) and
`conformance-known-gaps.json` in the checkout, so it needs no flags. It uses nothing else from the checkout: the server's
config and its side of the control contract come with the tests.

## What fails the job

- An **accepted** story the backend does not meet fails the job, unless it is listed in the backend's known gaps.
- A **proposed** story (`status: proposed`) that the backend does not meet is reported in the summary as `miss` and does
  not fail the job.
- A story the backend's adapter cannot set up (it needs a crash, a wire fault, an agent) is skipped, with the reason.
  The summary at the end of the log says what was verified and what was not.

## Known gaps live with the backend

`conformance-known-gaps.json` in the checkout (or `--known-gaps <file>`) is a JSON file in the backend's own repo:

```json
{ "C2": "an offline add is lost when the server rebuilds the notebook (#102)" }
```

A listed story still runs and is expected to fail. The day it passes, the job fails and asks for the entry to be removed.

## Releasing a new version of the tests

In the Actions tab of this repo, choose **Release > Run workflow** and pick `patch`, `minor` or `major`. No pull request is
needed. The workflow bumps the version, runs the tests, packs the package and stages it on npm. If that works it commits the
bump to `main`, tags it and drafts a GitHub release with the tarball.

Then a maintainer approves the staged version on npmjs.com, using 2FA, and publishes the draft GitHub release. Nothing is
public until the approval. npm trusts the workflow, so there is no npm token (see the comment at the top of
`.github/workflows/release.yml`). To look at what would be published, run `npm run package` and open `dist/`.
