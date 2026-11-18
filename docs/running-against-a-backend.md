# Running the conformance tests against a backend

The tests say what a person should experience when a notebook is shared in real time: a tab goes offline and keeps typing,
the server lets go of a notebook, a file changes underneath. They know nothing about how a backend does it, so you can
point them at any implementation. There is a built-in way to start jupyter-server-documents (`jsd`) and jupyter-collaboration (`jcollab`, with jupyter-server-nbmodel).

## Quick start

Inside the Python environment jupyter-server-documents is installed in (or with `--env <dir>` pointing at it). The tests need nothing from the codebase: they start the server with their own config.

```sh
npx @zsailer/jupyter-server-side-documents-conformance ssd run
```

That starts a JupyterLab with your tree, runs every story in real browsers, stops the server and tells you how it went (an illustration, not a real result):

```
  conformance v0.1.0
  jsd

  ✓ A     Control: a tab reconnects to a notebook the server rebuilt  18s
  ✗ C2    A second tab adds a cell while offline  31s
          step 4. Second tab adds a cell “typed while offline” — tab: 3 cells, expected 4
  ◐ H4    Two out-of-date tabs, the old session forgotten  24s
          known gap: typing is lost across a rebuild (#102)
  ◇ FLOW1 A tab loses its connection a moment after typing  12s
          proposed, not met: tab: cell 0 reads "c0", expected "c0 +TYPED"

  14 passed  ·  1 failed  ·  1 known gap  ·  1 proposed, not met  ·  52 skipped   7m 40s

  Skipped
   41  adapter "jsd" cannot: releaseRoom  (S1, S4, S5, …)
```

The first run unpacks the tests into `~/.cache` and installs their dependencies, which takes a few minutes. After that it
starts straight away. To keep a copy on your machine, `npm install -g @zsailer/jupyter-server-side-documents-conformance`
gives you the `jupyter conformance ssd` command. Run it with nothing after it for a welcome screen and the places to start.

`jupyter conformance` works because `jupyter` runs any `jupyter-<name>` program it finds on your `PATH`, whatever language
it is written in, as JupyterLab, Jupyter Server and the others do. This package adds a `jupyter-conformance` program and
does not change `jupyter` or any other subcommand. It needs the global install: `npx` runs the program directly, so there
you leave out `jupyter conformance` and start with `ssd`, as above. The word `ssd` picks the suite (server-side documents).

## Choosing what to run

Not sure which story you want? `jupyter conformance ssd pick` shows them in a list, grouped as on the page, with what each needs from
a backend, and runs the ones you choose:

```
  Pick the stories to run
  ↑↓ move · space select · a all shown · g whole group · / filter · enter run · q quit
  filter offline  (escape clears it)

  RECONNECTING  ·  3
 ❯ ◉ C3    A second tab types into a cell while offline
   ◉ C2    A second tab adds a cell while offline
   ○ C1    Control: the first tab adds a cell while offline

  2 selected   ↓ 17 below
```

| key | |
|---|---|
| `↑` `↓` (or `j` `k`) | move |
| `space` | select or unselect the story under the arrow |
| `a` | select everything shown (again: unselect it) |
| `g` | select the whole group the arrow is in |
| `/` | filter by what you type: an id, a word in a title, a group, or a need such as `releaseRoom`; `escape` clears it |
| `enter` | run what is selected, or the story under the arrow if nothing is |
| `q` | leave without running |

`jupyter conformance ssd run -i` is the same thing with the run options you give it (`--env`, `--headed`, ...). It needs a terminal:
in a script, name the stories.

## Commands

```sh
jupyter conformance ssd help                   # what it is, and where to start
jupyter conformance ssd help run               # every option, with examples
jupyter conformance ssd list                   # every story, grouped, and what it needs from a backend
jupyter conformance ssd list --filter offline  # only the stories about offline
jupyter conformance ssd pick                   # choose stories from a list
jupyter conformance ssd run                    # every story
jupyter conformance ssd run Z3 C2              # just these
jupyter conformance ssd run 'AI*'              # a prefix
jupyter conformance ssd run --group handshake  # one group of the page
jupyter conformance ssd run --headed           # watch the browsers
jupyter conformance ssd run --open             # open the side-by-side video of each failed story
```

A mistyped command or option gets a suggestion (`Did you mean --headed?`).

Another backend, or a server you already started:

```sh
jupyter conformance ssd run --backend jcollab --env environments/jupyter-collaboration/.venv  # jupyter-collaboration (see environments/)
jupyter conformance ssd run --url http://localhost:8888                 # a server that is already running
jupyter conformance ssd run --start "my-server --port {port}"           # your own command that starts one
```

A server that does not implement the [control contract](backend-contract.md) still runs every story that needs nothing
from the backend; the rest are skipped, and the summary says how many and why.

`jupyter conformance ssd --help` has the rest (`--env`, `--known-gaps`, `--out`, `--root-dir`, `--adapter`).

## Reading a result

| | |
|---|---|
| `✓` | The backend does what the story says. |
| `✗` | It does not. The line under it says what a person would have found. Open the side-by-side video (`--open`): every tab is filmed on one clock, with the story's step underneath. |
| `◐` known gap | A story this backend is known not to meet yet, and which fails as expected. If it ever passes, the run fails and asks you to delete the entry. |
| `◇` proposed | A case still being discussed. It is run and reported, but never fails the run. |
| skipped | The backend's adapter cannot cause what the story needs (the server letting go of a notebook, a crash, a wire fault, an agent). The summary says what is missing, so you can see what was verified and what was not. |

The exit code is 0 when no story failed, so it works as a CI step.

## Known gaps

A backend that does not yet meet an accepted story lists it in a JSON file in its own repo, with the reason:

```json
{ "C2": "an offline add is lost when the server rebuilds the notebook (#102)" }
```

Save it as `conformance-known-gaps.json` in the directory you run from, or point at it with `--known-gaps`. A listed story
still runs. That keeps a run green while the gap is open, and turns it red the day the story passes.

## Another backend

Give the backend three small test-only endpoints (what it can do, what the server holds, and "let go of this notebook")
and the tests find out what it offers by asking. The contract, and how to add jupyter-collaboration, jupyverse or any
other backend, is in [the backend contract](backend-contract.md).

## In CI

See [running in CI](running-in-ci.md).
