# Running the conformance tests against a backend

The tests say what a person should experience when a notebook is shared in real time: a tab goes offline and keeps typing,
the server lets go of a notebook, a file changes underneath. They know nothing about how a backend does it, so you can
point them at any implementation. Today there is an adapter for jupyter-server-documents.

## Quick start

From the root of a jupyter-server-documents checkout, inside the environment you develop it in:

```sh
npx @jupyter-ai-contrib/jupyter-server-side-documents-conformance run
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
starts straight away. To keep a copy on your machine, `npm install -g @jupyter-ai-contrib/jupyter-server-side-documents-conformance`
gives you a `conformance` command.

## Commands

```sh
conformance run                    # every story
conformance run Z3 C2              # just these
conformance run 'AI*'              # a prefix
conformance run --group handshake  # one group of the page
conformance run --headed           # watch the browsers
conformance run --open             # open the side-by-side video of each failed story
conformance list                   # every story, and what it needs from a backend
```

A server that is already running works too, which is the way to point the tests at something that is not started by the
adapter:

```sh
conformance run --url http://localhost:8888 --backend generic
```

`conformance --help` has the rest (`--env`, `--ui-tests`, `--known-gaps`, `--out`, `--root-dir`).

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

An adapter is a small module that says what the backend can do (`capabilities`) and how to cause it (release a notebook,
crash the server, change the file from outside). A story the adapter cannot do is skipped, with the reason. See
`compliance/README.md` and `compliance/adapters/jsd.ts`, and run it with `--backend /path/to/adapter`.

## In CI

See [running in CI](running-in-ci.md).
