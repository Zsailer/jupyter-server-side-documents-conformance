# The storyboards page

Every story of the multi-tab storyboard, as a live demo on Jupyter-style notebook windows, with light and dark themes.

```sh
npm run build          # from the repository root: writes examples/storyboards/site/index.html
open examples/storyboards/site/index.html
```

It is one self-contained file: no network, no build step to read it. Host it as it is.

## Where the stories come from

`data/` is a **snapshot** of the storyboard files of
jupyter-server-documents PR #100,
taken from its head commit `b916a21185adc00e5ed76e3cca53126249b917f8`:

| here | in the PR (`jupyter_server_documents/tests/acceptance/`) |
|---|---|
| `data/storyboards/*.yaml` | `storyboards/*.yaml` (`page.yaml` and one file per group) |
| `data/suite.yaml` | `suite.yaml` (read only for the order of the groups, which stories are open questions, and which apply only with a history record) |
| `data/storyboard_reference.py` | `storyboard.py`, kept for reference: the PR's own renderer and the original description of the grammar. Not used by the build. |

The stories are written by the authors of that PR; this page changes none of their words. To refresh after the PR
changes, copy those files over `data/` and rebuild. If the stories later live in their own repo, point the build at it:

```sh
python3 -I examples/storyboards/build.py --data /path/to/storyboards -o out.html
```

(`--data` is a directory with `page.yaml` and the group files, in `storyboards/` or directly; `suite.yaml` is optional.)

## What differs from the PR's page

The PR draws each story as a static swimlane. This page plays the same steps as live notebook windows. Both read the
same files. This page does **not** re-run the PR's checks that tie each story to `suite.yaml` (every scenario has a
story, exactly the unsettled ones have a decision), because that coupling belongs with the suite; `tests/test_spec.py`
asserts the second one for this snapshot.

## How the cells look

`cells.yaml` says what the cell names stand for. Anything not listed is drawn as `print("name")`:

- `c0`, `c1`, `c2` are the player's defaults: a pandas import, a read and a describe.
- `fixed`, `EDITED ON DISK`, `EXTERNAL EDIT`, `EDITED OFFLINE` are notes that rewrite a cell; they are mapped to code in `rewrites`.
- Typed text such as `+B-TYPED` is drawn as a trailing comment, `# B-TYPED`.

## Files

| | |
|---|---|
| `build.py` | Loads, validates and builds. |
| `template.html` | The page, with placeholders. |
| `page.css`, `page.js` | The page around the stories: top bar, side list, search, filters, theme switch. |
| `cells.yaml` | What cell names stand for. |
| `data/` | The snapshot above. |
| `site/` | The built page (ignored by version control). |
