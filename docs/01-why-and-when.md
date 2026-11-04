# Why live scenarios, and when to use them

## The problem with describing a scenario

Take: *"Two tabs have the notebook open. The second loses its connection and the user types into c1. Meanwhile the first
tab deletes c1. Then the second tab reconnects."*

To judge what the product should do you have to hold four things in your head at once: what each tab shows, what the
server holds, what is in the file, and in what order they changed. A table of steps helps. A picture of the end state
helps. But the thing people actually care about is **what the person at the keyboard sees**, and that is only
convincing when you watch it happen on something that looks like their notebook.

## What a live scenario gives a reader

- **A window per place a copy of the notebook lives.** Tabs, server, file. Each looks like JupyterLab, so a reader
  recognises it immediately and reads cells as cells.
- **A live cursor and real typing.** "The user types into c1" becomes characters appearing in c1, in the tab that is
  offline, while the other tab does something else.
- **A visible jump.** The most important moments (a reconnect, a rebuild, a crash) are over in a blink. The player does
  not give them the same screen time as the rest; it shows what differs, then cuts to the result, as the user would
  experience it.
- **The ending, side by side.** At the end every window shows what it holds, so "everyone ends with the same
  notebook" is something you check by looking.
- **Alternatives you can play.** Where the right behavior is undecided, each option can show its own ending, and the
  reader switches between them.

## When to use it

Use a live scenario when **the question is about what people see over time across more than one copy**:

- sync, collaboration and offline behavior
- what an AI agent's edit looks like to a person who is typing
- what survives a crash, a restore, an external change
- anything where reviewers are *aligning on product behavior* before code exists

## When not to

- A single screen with no history: use a screenshot.
- Behavior that is about numbers or performance: use a chart.
- A flow of clicks through a UI: use a recording or a prototype. The player draws notebook *state*, not arbitrary UI.

## Two patterns

| Pattern | What it is | Use it for |
|---|---|---|
| **The problem in one picture** (`NbScenario.triptych`) | A few notebook windows side by side, each a moment in time, with a caption. Static. | The opening of a page, or a doc that must also print. Say the point in three frames. |
| **The case player** (`NbScenario.mount`) | One story, played step by step across several windows, with a play/pause button and a bar of steps. | Every individual scenario. |

A good page opens with one triptych (the point), then lets the reader open as many case players as they like.

## What it deliberately is not

- Not a recording. Nothing is captured; everything is drawn from the written story, so it is always in step with the
  text and can be searched, diffed and reviewed like any other source file.
- Not a test. It shows the *intended* behavior. If you also run the stories as tests, keep that connection in your
  own repo; the page should say what the product does, whatever any version of the code does today.
