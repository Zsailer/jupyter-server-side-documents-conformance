# Compliance tests

Tests that check **what a person experiences** in JupyterLab when documents are shared in real time, whatever server-side implementation sits behind it. They are generated from the [storyboards](../examples/storyboards/), so the page people read and the tests a backend must pass are the same stories.

> **Status:** the generator, the runtime and the adapter are tested without a browser. Runs against jupyter-server-documents have found real differences and harness bugs; see [Running it](#running-it). For how to run the tests against a codebase, start with [`docs/running-against-a-backend.md`](../docs/running-against-a-backend.md); to add another backend, [`docs/backend-contract.md`](../docs/backend-contract.md).

## The idea

A storyboard says what happens and how it must end:

> Two tabs have the notebook open. The second loses its connection and the user types into c1. Meanwhile the first tab deletes c1. Then the second tab reconnects. — *the deletion wins, as it does between two people who are online.*

`generate.py` turns each story into a [Galata](https://github.com/jupyterlab/jupyterlab/tree/main/galata) test that does exactly that in real browsers — one browser per tab, so one can go offline on its own — with real keystrokes, and at the end checks what **every copy** holds: each open tab, a fresh tab (what the server holds), and the file.

```ts
await s.step(4, "Second tab", "types “+B-TYPED” at the end of c1", async () => {
  await tab2.type(1, " +B-TYPED");
  await s.expectTab(tab2, ["c0", "c1 +B-TYPED", "c2"]);
});
...
await s.ends([
  { tab: ["c0", "c2"], tab2: ["c0", "c2"], server: ["c0", "c2"], file: ["c0", "c2"] },       // proposed
  { tab: ["c0", E.contains("c1", "+B-TYPED"), "c2"], ... },                                   // the alternative
]);
```

Nothing in a test names an implementation. The tests see the browser, the Contents API and, where a story needs it, an **adapter**.

## What a backend must be able to do

A story needs the backend's help only to *cause* an event: the server letting go of a notebook, dying, a file changed from outside. A backend's **adapter** declares which of these it can do. A story whose needs the adapter does not meet is **skipped, with the reason**, so a report says what was verified and what was not — not "all green" because nothing ran.

| capability | what it is |
|---|---|
| *(none)* | people typing, adding, moving, deleting; tabs going offline, reconnecting, opening, closing |
| `releaseRoom` | the server lets go of a notebook (saving it); the next client makes it build it again from the file |
| `fileSystem` | the file is changed, removed or restored from outside Jupyter |
| `crashServer` | the server dies without saving, and starts again |
| `wireFaults` | a message between a tab and the server is lost or late |
| `agent` | an AI agent edits the notebook, through the server or the file |
| `historyRecord` | the server keeps a history record next to the file (optional) |
| `serverState` | *(optional)* the server can say what its own copy holds; otherwise a fresh tab is opened to see |

[`COVERAGE.md`](COVERAGE.md) is generated with the tests (`npm run generate`; none of the generated files are committed): it lists what every story needs and how many stories each capability unlocks. Today `releaseRoom` is by far the most needed, because most stories turn on the server rebuilding a notebook from its file. Making that portable (for instance, by restarting the server) is the most useful thing a backend can offer.

## Adapters

| adapter | does | use |
|---|---|---|
| `http` (default) | asks the server what it can do (`GET /conformance/capabilities`) and uses the [control contract](../docs/backend-contract.md) for it; with no answer it does nothing beyond the browser and the Contents API | any backend, with or without the contract |
| `generic` | never asks the server for anything | a server you know has no contract |
| your own | `--adapter ./path/to/adapter.ts` (`COMPLIANCE_ADAPTER`): a module whose default export is a [`BackendAdapter`](runtime/adapter.ts) | a backend that needs more than HTTP, such as one that can crash and restart its server |

The suite takes nothing from a backend's repo. For jupyter-server-documents it brings its own server config
([`server/conformance_config.py`](server/conformance_config.py)) and its own side of the contract
([`server/jsd_control.py`](server/jsd_control.py)).

## Running it

```sh
jupyter conformance ssd run --backend jsd   # start jupyter-server-documents, run every story, stop it (--backend is required)
jupyter conformance ssd run Z3 C2           # just these
jupyter conformance ssd run --url http://localhost:8888      # a server that is already running
jupyter conformance ssd run --start "my-server --port {port}"  # your own command that starts one
```

The command is `bin/conformance.mjs` (`node compliance/bin/conformance.mjs` in a checkout); see
[`docs/running-against-a-backend.md`](../docs/running-against-a-backend.md). Behind it is Playwright, which you can
also run yourself against a server that is already up:

```sh
cd compliance
npm install && npx playwright install chromium
npm run generate
COMPLIANCE_BASE_URL=http://localhost:8899 COMPLIANCE_ROOT_DIR=/tmp/compliance-root npx playwright test
npx playwright test -g "Z3"                       # one story
npx playwright test --grep @group-residual        # one group
npx playwright test --grep-invert @needs-alignment  # only the settled stories
```

The server must be set up the way JupyterLab's own UI tests set one up (no login, the app exposed to the page):
`server/conformance_config.py` does it for a Jupyter Server based backend, with `CONFORMANCE_CONTROL=jsd_control` to load
the backend's side of the contract.

| variable | |
|---|---|
| `COMPLIANCE_BASE_URL` | where the server is (default `http://localhost:8899`) |
| `COMPLIANCE_ADAPTER` | `http` (default), `generic`, or a path |
| `COMPLIANCE_KNOWN_GAPS` | a JSON file of accepted stories this backend is known not to meet yet |
| `COMPLIANCE_ROOT_DIR` | the folder the server serves; lets tests change the file from outside Jupyter |
| `COMPLIANCE_DECISIONS` | `'{"Z3":1}'` holds Z3 to its second option instead of the proposed one |
| `COMPLIANCE_TIMEOUT_MS`, `COMPLIANCE_SAVE_TIMEOUT_MS`, `COMPLIANCE_STABLE_MS`, `COMPLIANCE_SETTLE_MS` | waits (default 20 s, 40 s, 1.5 s, 0.75 s) |

## Reading a run

`jupyter conformance ssd run` ends with a summary; the same is available after any run with `python3 -I compliance/scripts/summarize.py`: one line per story (passed, or failed with the first line of why), what was skipped and what each skip lacked, and, for every story that is still an open question, **which of the storyboard's options the backend does**. A failing step names the storyboard step it was in, and every open tab is photographed at that moment.

## Watching a story

A story happens in several browsers at once, and Playwright films only the page it makes itself. So the tests film every tab (`runtime/recording.ts`) and write, next to the results of each story, **`watch.html`**: the videos of all the tabs side by side, on one clock, with the storyboard step shown underneath and a list of the steps. It is also attached to the report. `jupyter conformance ssd run` prints where the pages of failed stories are, and `--open` opens them.

## Going offline

A tab goes offline by having **its own browser** cut off, not with Playwright's `context.setOffline()`: in Chromium that makes every *other* browser opened while it is on start about seven times slower (measured: 5.9 s against 0.8 s, `tests/probe-offline.spec.ts`), which made any story that opens a tab after another has gone offline time out. `runtime/network.ts` refuses the browser's requests the way a real outage does (`ERR_INTERNET_DISCONNECTED`), closes its WebSockets, and makes any it opens fail at once, all inside that one browser. `COMPLIANCE_OFFLINE=emulate` brings back Playwright's own, for comparison. When a tab is back online and JupyterLab asks the person to click "Reconnect", the test clicks it, and the run says so.

## Open questions in the storyboards

A story marked *Needs alignment* has a proposed answer and alternatives. The test holds the backend to the **proposed** answer, tags itself `@needs-alignment`, and says so in its annotations. When the question is settled, the storyboard changes, the tests are generated again, and the answer is enforced everywhere at once.

## How a story becomes a check

For each step the generator knows what to do (`kind`) and, by comparing the cells of a lane before and after, **which keys to press**: add a cell *there*, type at the end of *that* cell, delete *this* one, move *that* one (the cell the story says moved, not the ones around it). It then writes what each lane must show after the steps a person does, and at the end.

- **Names to sources.** A cell `c1` is a code cell whose source is `c1`. Typed text `+B-TYPED` is typed after a space, so the cell reads `c1 +B-TYPED`. A note that rewrites a cell (`EXTERNAL EDIT`, `total = a - b`) is its new source.
- **Exact where the story is exact.** A cell is matched exactly (whitespace around it ignored). Typing from two people may land in either order. A recovered copy is found by what it holds, whatever it is wrapped in. Order is ignored where the story says a cell "stands at one of the two places".
- **What must not happen is enforced by counting.** The list at the end is exact, so a duplicate (`!c0=twice`) fails it; the check then waits to see that the notebook **stays** as it is, which catches a duplicate that arrives late.
- **What the storyboard leaves to words** goes in [`oracle.yaml`](oracle.yaml). Until a story has what it needs there, `COVERAGE.md` lists it under *checked loosely*.

## What is not here yet

- `restartServer` / a portable `releaseRoom`: today only an adapter that has an endpoint can release a room.
- Wire faults (`wireFaults`): lose or delay one message of the handshake. `page.routeWebSocket` can do it from the browser, but the message to lose is protocol-specific, so it belongs in an adapter.
- Agents, and history records: adapter-specific by nature.
- Outputs: the stories that mention outputs are checked for their cells, not their outputs.

## Layout

```
compliance/
  generate.py            the storyboards → tests/generated/*.spec.ts, stories.json, COVERAGE.md   (--check for CI)
  oracle.yaml            what the storyboards leave to words
  runtime/               Tab, Story, the matcher, the adapter interface
  adapters/              http (the default: speaks the control contract), generic
  server/                what the tests bring to a Jupyter Server backend: its config, and the jsd side of the contract
  bin/                   the `jupyter conformance ssd` command
  known-gaps/            accepted stories a backend is known not to meet yet
  tests/generated/       GENERATED: one spec per group of stories. Do not edit.
  unit/                  tests of the matcher (no browser)
  scripts/               package.py (the npm package), summarize.py
```
