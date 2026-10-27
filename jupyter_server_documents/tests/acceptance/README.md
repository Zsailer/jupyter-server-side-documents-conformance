# Acceptance suite for the divergent-sync handshake

Sixty stories of a browser tab and a server room, played with the **real room code of this checkout** and the **real client
sync code** (cut out of `src/docprovider/yprovider.ts` and run on real Yjs), and judged against what each is _supposed_ to
end with. It exists to qualify changes: run it on a tree, and it says which stories end as they should, which are known gaps,
which wait for a decision, and whether the change made anything better or worse.

It is the scenario matrix of upstream issue #305 grown to everything we have identified: the lost and the late reply, new tabs,
two stale tabs, offline edits across a rebuilt room, crashes, files that change under the room, outputs, `stop()`, and the
persisted lineage's own corners. On a tree that has only the stopgap (upstream 0.4.x), 22 of the 52 that can be played do not end as they
should; `suite.yaml` records exactly which, and why.

|                                                                           |                                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`suite.yaml`](suite.yaml)                                                | **The policy.** What every scenario must end with, what each kind of tree is expected to do, what is pending.        |
| [`SCENARIOS.md`](SCENARIOS.md)                                            | The scenarios in words: story, reference, floor, policy. Generated.                                                  |
| [`CATALOGUE.md`](CATALOGUE.md)                                            | The matrix: what each kind of tree is expected to do, and what was measured on every version of the code. Generated. |
| `scenarios/`                                                              | The stories, one module each. They play and observe; they never judge.                                               |
| [`STORYBOARDS.html`](STORYBOARDS.html)                                    | The stories as pictures for a design review: what the product does, step by step. Generated; hostable as it is.      |
| [`storyboards/`](storyboards), `storyboard.py`                            | The pictures, written by hand (one file per group), and the code that checks them against `suite.yaml` and draws them. |
| `__main__.py`                                                             | The runner: `python -m jupyter_server_documents.tests.acceptance`. One command for a person or a CI step.            |
| `test_acceptance.py`, `conftest.py`                                       | One test per scenario: play it, judge it, report it. The fixtures that find Node and the features of the tree.       |
| `test_suite_config.py`                                                    | Checks of `suite.yaml` itself and of the generated documents. No Node needed.                                        |
| `test_storyboards.py`                                                     | Checks of the storyboards and of the page: complete, in step with `suite.yaml`, no implementation words. No Node needed. |
| `test_runner.py`                                                          | Checks of the command line and of the rule that decides when the scenarios run. No Node needed.                      |
| `test_report.py`                                                          | Checks of how a run is worded: the scoreboard, the Markdown, the word for a known gap. No Node needed.               |
| `suite.py`, `report.py`, `render.py`, `features.py`, `compare_reports.py` | Reading the policy, the report, the generated documents, finding what a tree has, comparing two reports.             |
| `harness.py`, `node_client.mjs`                                           | The real room, the fake socket, the "tab" (a Node process). `outcomes.py` words a verdict in one line.               |
| `recorded.json`, `export_recorded.py`                                     | What the exploration kit measured on ten versions of the code, and the script that exports it.                       |

## Running it

It needs Node and the libraries of the browser side, which `jlpm install` puts in `node_modules`. (Node 22.13 or newer strips the
types of `yprovider.ts` itself; an older one uses the repository's `typescript`.)

```bash
jlpm install
python -m jupyter_server_documents.tests.acceptance                    # everything, about 3 minutes
python -m jupyter_server_documents.tests.acceptance --report out       # also write out/acceptance-report.{json,md}
python -m jupyter_server_documents.tests.acceptance --only B,G,C2      # just these scenarios
python -m jupyter_server_documents.tests.acceptance --group handshake  # one group (the names are in suite.yaml)
python -m jupyter_server_documents.tests.acceptance -x -v              # what it does not know goes to pytest
python -m jupyter_server_documents.tests.acceptance --list-profiles    # the kinds of tree suite.yaml knows
JSD_ACCEPTANCE_TRACE=1 python -m jupyter_server_documents.tests.acceptance --only B -s   # a story as it happens
```

The runner is the command for a CI step. It exits **0** if every scenario ended as `suite.yaml` expects of this kind of tree, and
**1** if one did worse (a regression), did better (`suite.yaml` must then be updated) or raised. **0 does not say that every
scenario ends as it should**: it says that nothing got worse (see "Reading a result"). The runner _fails_ when Node or its libraries
are missing, because a step that cannot run must not look like a step that passed (`--allow-skip` skips instead). `--report out`
leaves the matrix in `out/acceptance-report.md` (ready for a job summary or a pull request) and `out/acceptance-report.json`. It plays
the scenarios only; the checks that need no Node run with any `pytest`.

**It is calibrated for the `stopgap` tree**, the kind the branch is today (upstream 0.4.x without the lineage and the healing).
The kind is found from the checkout, so a CI step needs no `--profile`: it judges `stopgap` today and `lineage+healing` by
itself when those merge. `--profile NAME` judges a tree as another kind: with exactly the features of that profile, the client
without the healing and the room without its lineage store where the profile lacks them.

**Under plain pytest it is opt-in.** The scenarios take minutes and need Node, so a general `pytest` skips them with a message
saying how to ask (`-m "not acceptance"` leaves them out of the report altogether); only the checks that need no Node (of
`suite.yaml`, of the runner, of the report) run. The scenarios run when you point pytest at the directory
(`pytest jupyter_server_documents/tests/acceptance`, or a node id inside it), select by marker (`-m acceptance`, `-m group_<name>`),
or set `JSD_ACCEPTANCE=1`. (`-k` alone does not ask.) Unlike the runner, pytest skips them when Node is missing, unless
`JSD_ACCEPTANCE_REQUIRED=1`.

## Reading a result

A run ends with the matrix for the tree it ran on, and then with what it means:

```
id   group      expected   observed   result  what it ended with
B    handshake  reference  reference  ok      3/3/3
C2   handshake  floor      floor      gap     3/3/3 (tab 1: 3)
N1   rebuild    floor      floor      gap     typing LOST
...
30 of the 52 scenarios that can be played on a tree of kind 'stopgap' (features: none) end as they should; 22 do not.
  22 known gaps, recorded in suite.yaml: C2 C G2 K M1 N1 M2 R1 W1 W2 W3 S1 S5 S7 S2 S3 Q1 S4 X3 Z1 Z5 Z7
  5 of the 30 that end as they should do so under a best-effort answer, not yet confirmed: P1 Z2 Z3 Z4 Z6
  8 cannot be played on this tree (needs persisted_lineage): S6 S10 S11 S12 S13 S14 T1 X5
Against what suite.yaml expects of this kind of tree: 0 regressions, 0 improvements.
That judges the change, not the tree: a run without a regression still has the scenarios above that do not end as they should.

30 passed, 8 skipped, 22 known gaps in 163.70s (0:02:43)
```

**A green run is not a fixed tree.** Two questions are answered apart:

- _Does the tree do what it should?_ The first line, and the list under it: every scenario that does not end as it should is named,
  and `acceptance-report.md` tabulates each with its reason. `known gaps` is what pytest calls `xfailed`; it is never a pass, and it
  keeps pytest's last line from ending in green.
- _Did the change make anything worse?_ The last two lines, and the only thing the exit status says. 0 means no scenario did worse
  than `suite.yaml` expects of this kind of tree, and none did better without `suite.yaml` being told.

A failure prints the story step by step: what the tab and the room sent each other, what the client decided, what was dropped on
purpose, and what each copy of the notebook held at the end.

## How a scenario is judged

A scenario returns a **verdict**, a plain dictionary of what it observed (`server_cells`, `typing_kept`, ...). `suite.yaml`
judges it at three levels, weakest first:

| Level       | Meaning                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `none`      | The **floor** does not hold: something that must never happen did (a wipe, a duplicate, a hang, a lost server edit).         |
| `floor`     | The floor holds but the **reference** does not: nothing is lost that should not be, yet the story does not end as it should. |
| `reference` | The story ends the way it should.                                                                                            |

What a tree is expected to reach depends on its **kind**: the features it has, found in the checkout (`persisted_lineage`: the room
keeps its history across rebuilds; `healing`: the client puts back what the user did while disconnected). `profiles` in `suite.yaml`
names the four combinations. A scenario is expected to reach `reference` everywhere unless `expect` says otherwise (with a `why`), and
is `n/a` where `requires` names a feature the tree lacks.

| Expected vs observed                        | Result                                                  | pytest                                            |
| ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| the expected level                          | `ok` (reference) or `gap` (a known gap, with its `why`) | passed / `known gaps` (an xfail)                  |
| below the expected level                    | **WORSE**: a regression                                 | failed                                            |
| above the expected level                    | **BETTER**: update `suite.yaml` (see below)             | failed (`JSD_ACCEPTANCE_STRICT=0`: reported only) |
| policy pending, below the reference         | `?`: reported, not enforced (the floor still is)        | `pending a policy` (an xfail)                     |
| policy best effort                          | judged like a decided one: the reference is enforced    | as for a decided one                              |
| the scenario needs a feature the tree lacks | `n/a`                                                   | skipped                                           |

"Better than expected" fails on purpose: a gap that closed must be written down, or the next regression to the old level would pass
unnoticed.

## Changing the policy

`suite.yaml` is the only place that says what is right. After editing it run

```bash
python -m jupyter_server_documents.tests.acceptance.render
```

which regenerates `SCENARIOS.md`, `CATALOGUE.md` and `STORYBOARDS.html` (a test fails while they are stale). The catalogue judges the recorded measurements
of every version against the clauses as they are now, so a change of policy shows at once across all of them.

A scenario's **policy** has three states. `decided` (the default) is settled. `best_effort` is a provisional answer: enforced like a
decision, but listed under "Decisions taken as a best effort" in `SCENARIOS.md` with the question it answers and what the code does
today, so that it is easy to find, review and change. `pending` is a question nobody has answered: the reference is a proposal that
is reported, never enforced (the floor still is).

| I want to...                            | Edit                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| change how a story must end             | its `reference` (and `says`, the sentence that describes it).                                                                                |
| change what must never happen           | its `floor`.                                                                                                                                 |
| record that a tree does worse, as known | `expect: {<kind of tree>: floor}` and a `why`. The scenario needs a `floor` of its own.                                                      |
| record that a change closed a gap       | the same entry: drop it or set `reference`. This is what a BETTER result asks for.                                                           |
| settle a question for now               | `policy: {status: best_effort, question: ..., decision: ..., today: ...}` and the `reference` that answer implies. Enforced like a decision. |
| change a best-effort answer             | its `decision` and `reference` (and `says`), and the proposed option of its storyboard. The next run says what moves.                        |
| confirm a best-effort answer            | remove the `policy` key (or `status: decided`, with a note if you like).                                                                     |
| defer a decision                        | `policy: {status: pending, question: ..., today: ...}`. The reference becomes a proposal that is reported, not enforced.                     |
| add a scenario                          | a module in `scenarios/` (copy a similar one; it defines `ID`, `TITLE`, a docstring and `async def run()`), its entry in `suite.yaml` and its storyboard in `storyboards/`. |
| add a kind of tree                      | a feature under `features`, its detection in `features.py`, a profile under `profiles`, and an `expect` where it differs.                    |

Clauses (the building blocks of `floor` and `reference`) are lists of one-key mappings over the verdict. `a/b` reaches into a nested
verdict.

| Clause                         | Holds when                                         |
| ------------------------------ | -------------------------------------------------- |
| `equals: {field: value}`       | every named field has that value (`null` is None)  |
| `same: [f1, f2]`               | the named fields have the same value               |
| `at_least: {field: n}`         | the field is a number >= n (`at_most` likewise)    |
| `empty: [f1, f2]`              | the fields are empty: `[]`, `{}`, None, 0 or false |
| `one_of: {field: [a, b]}`      | the field has one of those values                  |
| `any: [c1, c2]` / `all: [...]` | at least one / all of the clauses hold             |
| `not: c`                       | the clause does not hold                           |

A reference that a wipe satisfies by accident is a bug in the reference; `test_suite_config.py` catches the common case (a verdict that
meets the reference but not the floor).

## Storyboards

[`STORYBOARDS.html`](STORYBOARDS.html) draws every story as a picture, step by step, for a design review: who does what (a tab, the
server, the file) and what the notebook holds when the story is over. It is one self-contained file (no network, no build step), so it
can be opened in a browser or hosted as it is.

It describes the **product**, not any version of the code. It says what a user must be able to count on and, for the stories whose
answer is not settled (the `best_effort` and `pending` policies of `suite.yaml`), marks them "Needs alignment" and shows the proposed
behavior next to the alternatives. It knows nothing of which tree gets each story right; that is `CATALOGUE.md`. A test keeps implementation
words (Yjs, client ids, checkpoints, the names of the kinds of tree) off the page.

The pictures are written by hand in [`storyboards/`](storyboards): `page.yaml` has the text of the page and one file per group of
`suite.yaml` has the stories of that group. A group of `page.yaml` marked `played: false` holds stories that no scenario plays yet
(today, the AI agent stories of `ai.yaml`: an agent such as Claude Code edits the server's live copy while the server holds the notebook, and
the file when it does not). They are drawn with a "not played" badge so that nobody takes them for verified, and their decisions say
"Suggested" instead of "Proposed", because nobody has discussed them. When a scenario is written for one, move the story into the file of
its group. The format is documented at the top of `storyboard.py`, which checks the files against
`suite.yaml` (every scenario has a storyboard; exactly the ones whose policy is not decided have a `decision`) and draws the page; the page
is regenerated with the other documents by `render`. To see how a new story looks without drawing all of them:

```bash
python -m jupyter_server_documents.tests.acceptance.storyboard --only B Z3 -o /tmp/storyboards.html
```

## Qualifying a change

```bash
git switch <the branch with the change>          # the tree is the base plus the change
jlpm install
python -m jupyter_server_documents.tests.acceptance --report out
```

The run says what the change does to the matrix, relative to what `suite.yaml` expects of that kind of tree: **WORSE** is a regression,
**BETTER** is a gap it closes. `out/acceptance-report.md` is ready to paste into the PR; `out/acceptance-report.json` has the same for
programs. To see the change against another tree, run the same on both and `python jupyter_server_documents/tests/acceptance/compare_reports.py base.json change.json`.

## What it does not do

- No browser and no JupyterLab: a "tab" is the client's sync code on real Yjs (`node_client.mjs`); no port is bound. The browser
  experience (the caret, the toast) is in `ui-tests/`.
- One configuration per run. The versions the kit measures also include an old client, the kill switch and a lost checkpoint store;
  those columns are in `CATALOGUE.md` as recorded, and the harness can play them (`JSD_ACCEPTANCE_SERVER_CONFIG`, `lose_store`), but
  `suite.yaml` does not yet say what to expect of them.
- The scenarios are copies of those of `repro/issue-70-divergent-sync` (PR #72), whose harness runs them across versions; this copy is
  the one that runs on every PR. Only the import line of each is changed, and the three waits for the server's deadline use
  `ENV.deadline` (2 s here, 5 s in production) instead of a literal 5.6.
- `node_client.mjs` cuts the handler out of `yprovider.ts` between `const messageSync = 0;` and
  `this._yWebsocketProvider.on('sync', this._onSync);`, and the repair helpers from `function hasDivergentHistory(` to the end of the
  file. If a refactoring moves that code, the suite fails at start-up and says so; update the markers there.

## Environment variables

| Variable                          | Effect                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `JSD_ACCEPTANCE=1`                | play the scenarios in a general `pytest` run too (the runner sets it)                                                |
| `JSD_ACCEPTANCE_REQUIRED=1`       | fail instead of skipping when Node or its libraries are missing (the runner sets it, so a step cannot silently stop) |
| `JSD_ACCEPTANCE_STRICT=0`         | report a BETTER result instead of failing on it                                                                      |
| `JSD_ACCEPTANCE_REPORT=DIR`       | write `acceptance-report.json` and `acceptance-report.md` into DIR                                                   |
| `JSD_ACCEPTANCE_FEATURES=a,b`     | judge the tree as if it had exactly these features (e.g. `persisted_lineage` to judge a tree without healing)        |
| `JSD_ACCEPTANCE_SERVER_CONFIG`    | traitlets configuration for the room as JSON, e.g. `{"LineageStore": {"enabled": false}}` (the kill switch)          |
| `JSD_ACCEPTANCE_CLIENT_TS=FILE`   | run another `yprovider.ts`, e.g. a deliberately broken one to see the suite fail                                     |
| `JSD_ACCEPTANCE_NODE_MODULES=DIR` | the `node_modules` to use (default: the repository's)                                                                |
| `JSD_ACCEPTANCE_TIME_SCALE=N`     | multiply the short settle sleeps (2 or 3 on a slow machine)                                                          |
| `JSD_ACCEPTANCE_DEADLINE=SECONDS` | the server's wait for a SyncStep2 reply in the scenarios that sit it out (default 2)                                 |
| `JSD_ACCEPTANCE_TRACE=1`          | print each story as it happens (with `pytest -s`)                                                                    |
