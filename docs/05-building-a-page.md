# Building a page

`player/` draws one story. A page is everything around many of them: navigation, search, a theme switch, the
principles the stories respect. `examples/storyboards/` is a worked example; this is how it is put together, so you can
make your own.

## The shape

```
your-docs/
  stories/            one YAML file per group of stories, plus page.yaml (title, intro, principles, group intros)
  cells.yaml          optional: what cell names stand for (bank, rewrites, outputs)
  build.py            reads the YAML, validates it, writes one self-contained HTML file
  template.html       the page, with {{PLACEHOLDERS}}
  page.css / page.js  the page around the stories
```

`examples/storyboards/build.py` is a short script. It does five things:

1. **Load** `page.yaml` and every group file; the file's name is the group.
2. **Validate** each story with `tools/nbscenario_spec.py`. A mistake stops the build, with the story and step named.
3. **Decorate** each story with what the page knows and the YAML does not: its group, its badges (*Needs alignment*,
   *Applies only if…*), and the word on a decision's proposed option.
4. **Render a text version** of every story (title, story, ordered steps, result) into the HTML. This is what is there
   without JavaScript, and what the player replaces.
5. **Inline** the player CSS and JS, the page CSS and JS and the story data, and write one file.

Everything is inlined on purpose: the output is one file you can attach to an email, open from disk, or host
anywhere. There is no server, no fetch and no network request.

## Mounting

```js
var data = JSON.parse(document.getElementById('data').textContent);
document.querySelectorAll('.story-card').forEach(function (card) {
  NbScenario.mount(card, data.stories[card.id], { config: data.config });
});
```

Mount every story up front. Unmounted cards would be a different height from mounted ones, and the page would jump when
a reader follows a link. Each player only animates while it is at least a third on screen, so sixty-nine of them cost
nothing while you read one.

## Keep the top of the stories page light

A reader came to see stories. Put a title, one paragraph and a link to the guide above them, and move everything that
explains how to read them to a second page: the problem in one picture, the key to the cells, the principles, the list
of open questions. `examples/storyboards` does this (`index.html` and `about.html`, one `build.py`). The guide is for
the first visit; the stories are for every visit after.

## The pieces worth copying

- **The problem in one picture**, once, on the guide page: `NbScenario.triptych`. Say the point of the whole page in three frames.
- **A key to the cells**, on the guide page: the marks (`+ - ^ ? !`) drawn with `NbScenario.miniHTML`. Readers should never have to guess
  what an amber cell means.
- **Search and filters** over the stories' text, with a filter for the ones that need a decision.
- **A side list** that follows where you are, and opens over the page on small screens.
- **A theme switch** (Auto / Light / Dark). See [Theming](04-theming.md).
- **Deep links.** Every story has an id: `page.html#Z3` opens it.

## Hosting

The page is static. Put `index.html` anywhere that serves files: an internal static site, GitHub Pages, an artifact
store, or an attachment. Rebuild when the stories change, in CI if you like:

```sh
npm install && npm test        # builds the page and runs every test
```

## Testing

`tests/` shows three levels, all fast:

| | |
|---|---|
| **Spec** (`test_spec.py`) | Every story is valid; mistakes are refused with a message; the Python and JavaScript vocabularies agree; the build is deterministic and has no external reference. |
| **Core** (`player.core.test.js`) | Every story builds a timeline; every frame draws every lane; typing is typed and merges are not; a reconnect is a blip that previews its difference; a decision option replaces the ending. |
| **Page** (`page.dom.test.js`) | The built page, in a simulated browser: every story mounts with no error; pause freezes the bar, the caption and the animations; clicking a step jumps; theme, search and filters work; a decision plays its alternative ending. |

What these cannot tell you is whether it *looks* right. Open the page in a real browser, in both themes and at a
narrow width, before you share it.

## Keeping the page honest

A page about *intent* should not drift into talking about the code. Two habits help:

- Keep a list of implementation words that must not appear on the page, and test for it (the multi-tab storyboards have one).
- Keep the link between a story and whatever tests play it **out of the page**: put it in a catalogue next to the tests.
