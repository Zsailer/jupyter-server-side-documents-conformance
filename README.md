# Notebook scenario docs

Live, side-by-side notebook demos for documenting **what a product does in each scenario**.

Instead of describing a scenario in a paragraph, you show it: real-looking Jupyter windows, one per tab, server and
file, that play the story step by step, with typing and a live cursor. The reader sees what each copy of the notebook
holds after every step, and how the story ends.

```
 Your tab (offline)        Second tab              Server
 ┌────────────────┐        ┌────────────────┐      ┌────────────────┐
 │[ ]: import pd  │        │[ ]: import pd  │      │[ ]: import pd  │
 │[ ]: df = …  ▌  │ ─────▶ │[ ]: df = …     │      │[ ]: df = …     │
 └────────────────┘        └────────────────┘      └────────────────┘
   ● Offline                 ● Connected             ● Holds the notebook
 ▶ ━━━━━━━●━━━━━━━⚡━━━━━━━━━━━━━  3 · types “+OFFLINE” into c1
```

**Live:** https://zsailer.github.io/jupyter-server-side-documents-conformance/
**Repo:** https://github.com/Zsailer/jupyter-server-side-documents-conformance

## What is here

| | |
|---|---|
| [`player/`](player/) | The library: `nbscenario.js` and `nbscenario.css`. No dependencies, no build step. |
| [`docs/`](docs/) | How to write a good scenario page. Start with [the guide](docs/01-why-and-when.md). |
| [`examples/minimal/`](examples/minimal/) | The smallest useful page: one picture and one live scenario. **Start here.** |
| [`examples/storyboards/`](examples/storyboards/) | A real page: the 69 stories of the multi-tab acceptance suite, built from YAML. |
| [`tools/`](tools/) | The scenario grammar as a validator (`nbscenario_spec.py`). |
| [`tests/`](tests/) | Tests of the core, of the built page in a simulated browser, and of the spec. |

## Try it

```sh
open examples/minimal/index.html          # nothing to install: it is one HTML file and two player files
```

To build and test the storyboards page:

```sh
npm install                                # jsdom, for the tests only
npm run build                              # writes examples/storyboards/site/index.html
npm test
```

To publish the storyboards page, after `npm install`:

```sh
npm run deploy                             # builds, runs every test, and publishes nothing
```

The built page is the folder `examples/storyboards/site/`, which `npm run build` writes.

## The idea in four moves

1. **Write the story, not the animation.** A scenario is a list of steps: who does what (`at`), what kind of thing it
   is (`kind`), and what that lane's copy of the notebook holds afterwards (`cells`). You never script an animation.
2. **The player works out what to show.** By comparing a lane's cells before and after a step it knows what was typed,
   added, moved, removed or changed by the system, and draws each the right way.
3. **Show the moment of change the way it happens.** A person's typing is typed. Something the system does
   (a merge, a rebuild) just appears. A reconnect is a blink in real life, so the player shows what is about to differ,
   then jumps. See [Designing a good scenario](docs/03-designing-a-good-scenario.md).
4. **Keep the words.** Every story keeps its steps as text, so it works without JavaScript, for screen readers, and in
   a review.

## Where this came from

It was built to document the scenarios of jupyter-server-documents PR #100:
a storyboard of what Jupyter should do when connections drop, servers let go of notebooks, files change underneath,
and AI agents edit. The same grammar and player work for any "who does what to a shared notebook" documentation.
