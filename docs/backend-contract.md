# The control contract: what a backend gives the tests

The tests check what a person sees: what is in their tab, in a fresh tab, and in the file. For most stories that is all
they need, and a backend with nothing else still runs them. A few stories need the backend's help to *cause* an event
the story describes. This is the contract a backend implements to give it, small enough that a backend can add it as a
test-only server extension.

Nothing here names an implementation, and the tests take nothing from a backend's repository: not its test folder, not
its config. A backend that implements the contract is run with `jupyter conformance ssd run --start "<command>"` or `--url`.

## The endpoints

All under the server's base URL, behind the server's own authentication, and **for tests only**: they let a client
destroy live documents, so never load them in production.

### `GET /conformance/capabilities`

What this backend can do for a test.

```json
{ "backend": "jsd", "capabilities": ["serverState", "releaseRoom"] }
```

`backend` is a short name, used to find the backend's known gaps (`known-gaps/<backend>.json`) and shown in reports.
A capability the tests do not know is ignored. A server without this endpoint, or that answers an error, offers nothing:
the stories that need no help from the backend still run.

| capability | endpoint(s) it needs | what it unlocks |
|---|---|---|
| `serverState` | `GET /conformance/room` | a story can check what the server itself holds, as well as every tab and the file |
| `releaseRoom` | `POST /conformance/release-room` | "the server lets go of the notebook and later builds it again from the file". Most stories turn on this one |

### `GET /conformance/room?path=<path>`

The server's live copy of the notebook at `path` (relative to the server's root), as the source of each cell:

```json
{ "cells": ["import pandas as pd", "df = pd.read_csv('x.csv')"] }
```

`404` if the server holds no live copy (nobody has it open, or it was released). It must never create one.

### `POST /conformance/release-room?path=<path>`

The server **saves** the notebook to its file and **lets go** of its live copy. Connected clients are disconnected the way
the backend disconnects them when it lets go of a document. The next client that connects makes the server build the
notebook again from the file. `200` when done, also when there was nothing to release.

## What the tests bring themselves

- **A server configuration** for Jupyter Server based backends: no login, the app exposed to the page, root allowed, and
  the frontend extensions named in `CONFORMANCE_DISABLED_EXTENSIONS` switched off (`server/conformance_config.py`). Load your side of
  the contract through it by setting `CONFORMANCE_CONTROL=<module in server/>`.
- **A start command**, when you give one: `--start "<command>"`, run with `{port}` replaced and `CONFORMANCE_PORT` set. It
  must serve JupyterLab, with the server configured as above, on that port.

A backend that is not a Jupyter Server (jupyverse, for instance) needs its own way to expose the app to the page and to
serve the three endpoints, and starts with `--start` or `--url`.

## Capabilities that need more than HTTP

Some capabilities need to act on the process or on the wire, not on the server's API: `crashServer` (kill it without a
save and start it again), `wireFaults` (lose or delay one message between a tab and the server), `agent` (an AI agent
edits the notebook), `historyRecord`. These are not in the HTTP contract. A backend that wants those stories writes an
adapter (`--adapter ./my-adapter.ts`, a module whose default export is a
[`BackendAdapter`](../compliance/runtime/adapter.ts)), which can do anything it needs. Until then those stories are
skipped, with the reason.

## Adding a backend

1. Implement the three endpoints as a test-only extension of the backend, in its own repo or in `compliance/server/`.
   [`compliance/server/jsd_control.py`](../compliance/server/jsd_control.py) is the example for jupyter-server-documents:
   about a hundred lines, and the only file that knows how that backend keeps its rooms.
   [`jcollab_control.py`](../compliance/server/jcollab_control.py) is the same for jupyter-collaboration.
2. Start the backend with the server config of the tests and your extension, and run the tests against it.
3. Keep a `conformance-known-gaps.json` for the accepted stories it does not meet yet.

What to expect from a first run: the stories that need nothing from the backend run, and every story that needs
`releaseRoom` is skipped until step 1 is done. The summary at the end of a run says how many.
