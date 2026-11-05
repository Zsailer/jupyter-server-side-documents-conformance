# Compliance tests

Tests that check **what a person experiences** in JupyterLab when documents are shared in real time, whatever server-side implementation sits behind it. They are generated from the [storyboards](../examples/storyboards/), so the page people read and the tests a backend must pass are the same stories.

> **Status: generated and type-checked, not yet run against a live backend.** The generator, the runtime and the adapters are tested without a browser (matching, planning, freshness, types). The first run against a real server is the next step; until then treat a failure as "either the backend or the harness", and expect harness fixes. See [Running it](#running-it).

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

[`COVERAGE.md`](COVERAGE.md) is generated with the tests: it lists what every story needs and how many stories each capability unlocks. Today `releaseRoom` is by far the most needed, because most stories turn on the server rebuilding a notebook from its file. Making that portable (for instance, by restarting the server) is the most useful thing a backend can offer.

## Adapters

| adapter | does | use |
|---|---|---|
| `generic` | nothing beyond the browser and the Contents API (and `fileSystem` if `COMPLIANCE_ROOT_DIR` is set) | any JupyterLab with real-time collaboration |
| `jsd` | adds `serverState` and `releaseRoom`, through the test-only endpoints of jupyter-server-documents' own UI tests | jupyter-server-documents |
| your own | `COMPLIANCE_ADAPTER=./path/to/adapter.ts` — a module whose default export is a [`BackendAdapter`](runtime/adapter.ts) | anything else |

## Running it

**The short way**, for jupyter-server-documents: one command starts a server, runs the tests, and stops the server.

```sh
sh compliance/scripts/run-jsd.sh                      # story Z3, browsers showing
sh compliance/scripts/run-jsd.sh -g "Z1|Z2|Z3|Z4"     # any Playwright arguments
```

It finds an environment that has jupyter_server_documents in a checkout of jupyter-server-documents (`DEV_REPO` if yours is
elsewhere), or use `JSD_ENV` and `JSD_UI_TESTS`. The server's log is `/tmp/compliance-server.log`. The long way, step by step:

1. **Start a JupyterLab** the way JupyterLab's own UI tests do: no login, and the app exposed to the page (`from jupyterlab.galata import configure_jupyter_server; configure_jupyter_server(c)` in its config). For jupyter-server-documents, [`scripts/start-jsd-server.sh`](scripts/start-jsd-server.sh) does it from its `ui-tests`. A server with extensions that pop modals on start will time every test out: disable them.
2. **Run**:

   ```sh
   cd compliance
   npm install && npx playwright install chromium
   COMPLIANCE_ADAPTER=jsd COMPLIANCE_ROOT_DIR=/tmp/compliance-root npx playwright test
   npx playwright test -g "Z3"                       # one story
   npx playwright test --grep @group-residual        # one group
   npx playwright test --grep-invert @needs-alignment  # only the settled stories
   ```

| variable | |
|---|---|
| `COMPLIANCE_BASE_URL` | where the server is (default `http://localhost:8899`) |
| `COMPLIANCE_ADAPTER` | `generic` (default), `jsd`, or a path |
| `COMPLIANCE_ROOT_DIR` | the folder the server serves; lets tests change the file from outside Jupyter |
| `COMPLIANCE_DECISIONS` | `'{"Z3":1}'` holds Z3 to its second option instead of the proposed one |
| `COMPLIANCE_TIMEOUT_MS`, `COMPLIANCE_SAVE_TIMEOUT_MS`, `COMPLIANCE_STABLE_MS`, `COMPLIANCE_SETTLE_MS` | waits (default 20 s, 40 s, 1.5 s, 0.75 s) |

## Watching a story

A story happens in several browsers at once, and Playwright films only the page it makes itself. So the tests film every tab (`runtime/recording.ts`) and write, next to the results of each story, **`watch.html`**: the videos of all the tabs side by side, on one clock, with the storyboard step shown underneath and a list of the steps. It is also attached to the report. `run-jsd.sh` prints where they are and opens the page when you ran a single story.

## Open questions in the storyboards

A story marked *Needs alignment* has a proposed answer and alternatives. The test holds the backend to the **proposed** answer, tags itself `@needs-alignment`, and says so in its annotations. When the question is settled, the storyboard changes, the tests are generated again, and the answer is enforced everywhere at once.

## How a story becomes a check

For each step the generator knows what to do (`kind`) and, by comparing the cells of a lane before and after, **which keys to press**: add a cell *there*, type at the end of *that* cell, delete *this* one, move *that* one (the cell the story says moved, not the ones around it). It then writes what each lane must show after the steps a person does, and at the end.

- **Names to sources.** A cell `c1` is a code cell whose source is `c1`. Typed text `+B-TYPED` is typed after a space, so the cell reads `c1 +B-TYPED`. A note that rewrites a cell (`EXTERNAL EDIT`, `total = a - b`) is its new source.
- **Exact where the story is exact.** A cell is matched exactly (whitespace around it ignored). Typing from two people may land in either order. A recovered copy is found by what it holds, whatever it is wrapped in. Order is ignored where the story says a cell "stands at one of the two places".
- **What must not happen is enforced by counting.** The list at the end is exact, so a duplicate (`!c0=twice`) fails it; the check then waits to see that the notebook **stays** as it is, which catches a duplicate that arrives late.
- **What the storyboard leaves to words** goes in [`oracle.yaml`](oracle.yaml). Until a story has what it needs there, `COVERAGE.md` lists it under *checked loosely*.

## What is not here yet

- A live run, and the harness fixes that will bring.
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
  adapters/              generic, jsd
  tests/generated/       GENERATED: one spec per group of stories. Do not edit.
  unit/                  tests of the matcher (no browser)
  scripts/               start a jupyter-server-documents server for the tests
```
