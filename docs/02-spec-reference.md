# Spec reference

A scenario is a plain mapping (YAML or JSON). The player takes it as JSON; `tools/nbscenario_spec.py` is the same
grammar as a validator, and `tests/test_spec.py` keeps the two in agreement.

```yaml
A:
  title: "Typing made offline is kept"
  story: "Two tabs have the notebook open. ..."          # what happens, in plain words
  lanes: {tab: "Your tab", tab2: "Second tab", server: "Server"}   # optional: which windows, and their names
  start: {file: [c0, c1, c2]}                            # optional: what each lane holds at the start
  steps:
    - {at: tab, kind: type, text: "types “+OFFLINE” into c1", cells: [c0, "c1=+OFFLINE", c2]}
  result: "What the product does."
  ends: {all: [c0, "c1=+OFFLINE", c2]}                   # what every lane holds at the end (or one entry per lane)
  risk: "What a user sees if it goes wrong."             # optional
  decision: ...                                          # optional: an open question, see below
```

`id` and `badges` are added by whatever builds the page (see `examples/storyboards/build.py`).

## Lanes: the windows

| Lane | Drawn as | Holds a copy? |
|---|---|---|
| `tab`, `tab2`, `tab3`, `tab4` | A browser tab with the notebook open. Shows an active cell and a live cursor. | yes |
| `server` | The server's live copy of the notebook. | yes |
| `file` | The saved file on disk. | yes |
| `record`, `store` | A box for something else the server keeps (a history record, an output store). | optional |
| `ai` | An agent card. It acts, and shows what it is doing, but holds no notebook. | **no** |

If you do not give `lanes`, the story draws the lanes that its `start`, `steps` and `ends` use. A lane that has not
yet taken part is drawn faded and dashed ("not yet"), so the windows do not jump around as the story goes on.

If you give no `start`, the file starts with three cells (`c0`, `c1`, `c2`), when the file lane is drawn.

## Steps

```yaml
- {at: tab2, kind: reconnect, to: server, text: "reconnects", cells: [c0, c1, c2]}
```

| key | meaning |
|---|---|
| `at` | A lane, or a list of lanes that do the same thing together. |
| `kind` | What sort of step it is. Picks the icon, the status a lane takes and how the step is drawn. |
| `text` | What happens, in a sentence. Shown under the windows and in the text version. |
| `cells` | Optional. What that lane's copy holds **after** the step. Leave it out when the lane's cells do not change. A string is a remark about the lane; `[]` is nothing. |
| `to` | Optional. Another lane the step sends something to. A dot flies from one window to the other. |

### Kinds

`user` kinds are things a person does: their cell changes are drawn as typing. `blip` kinds are over in a moment in real
life: they are drawn short, shown amber, and preview what differs before the result appears.

| kind | what it is | status it sets | |
|---|---|---|---|
| `open` | A tab opens the notebook. | tab: Connected · server: Holds the notebook | |
| `offline` | A tab loses its connection. | tab: Offline | |
| `reconnect` | A tab comes back. | tab: Reconnecting… | blip |
| `leave` | A tab goes away. | tab: Closed | |
| `type` | Someone types, rewrites. | | user |
| `add` | Someone adds a cell. | | user |
| `delete` | Someone deletes a cell. | | user |
| `move` | Someone moves a cell. | | user |
| `run` | Someone runs a cell. | | user |
| `free` | The server lets go of the notebook. | server: Not holding it | |
| `rebuild` | The server builds the notebook again from the file. | server: Rebuilding… | blip |
| `crash` | The server dies. | server: Stopped | blip |
| `save` | The file is saved. | file: Saved | |
| `outside` | The file is changed outside the product. | file: Changed outside | |
| `remove` | The file is deleted. | file: Deleted | |
| `restore` | The file is put back from a backup. | file: Restored | |
| `deadline`, `late`, `fault` | A wait, a late answer, a lost message. | | |
| `note` | The system does something worth saying (a merge). | | |

A status that is only momentary (`Reconnecting…`, `Rebuilding…`) settles to Connected / Holds the notebook at the next step.

## Cells

A cell is a short string. The first character is a mark; `=` starts a note.

| token | meaning | drawn as |
|---|---|---|
| `c0` | a cell | plain |
| `c0=+OFFLINE` | a cell that was edited, with what was added | the added text, highlighted |
| `+NEW-B` | a cell that was added | green bar |
| `-c1` | a cell that was removed | struck through, then gone |
| `^c0` | a cell that was moved | blue bar, ↕, flashes when it lands |
| `?c1=recovered` | a copy set aside for the user | amber, tagged |
| `#c0=1 output` | a cell with an output | an output under the cell |
| `!c0=twice` | something that must never happen | red, tagged |
| `*text` | a remark, not a cell | italic note |

`cells` may also be `"a remark"` (a remark about that lane) or `[]`.

### How a cell name becomes code

The story says `c1` or `ONLINE CELL`; the window needs code. The player looks the name up in `config.bank`:

```js
NbScenario.mount(el, story, { config: { bank: { c1: 'df = pd.read_csv(path)' } } });
```

A name that is not in the bank is drawn as `print("name")`, so a story always works without a bank; the bank only
makes it read better. The defaults are `c0`/`c1`/`c2` (a pandas import, a read, a describe), `tests` and `docs`.

### How a note changes a cell

| note | what the cell shows |
|---|---|
| `+TEXT` (also `+A +B`) | the text, typed after the code as a comment: `df = pd.read_csv(path)  # TEXT` |
| `N output` | an output block (`config.outputs`) |
| a note that is a key of `config.rewrites` | the code from `rewrites`, and the note as a tag |
| `X + TEXT`, X in `rewrites` | both |
| a note containing ` = ` | the note **is** the new code (`c0=total = a - b`) |
| anything else | the note, as a tag on the cell |
| a name `c1 +TEXT` | a copy of `c1` with `TEXT` typed in it |

## What the player works out for itself

By comparing each lane's cells before and after a step:

- a **new cell** added by a person (`type`, `add`, …) is typed in whole;
- **text added** to a cell by a person is typed at the end of that cell, with the cursor in it;
- the same change made by the system (`note`, `rebuild`, `reconnect`, …) simply **appears**, with a flash;
- a **removed cell** is shown struck through for a moment, then goes;
- a **moved cell** flashes where it lands;
- on a **reconnect**, the cells that differ between the tab and the server (or, if the server holds nothing yet, a tab
  that is still connected) are outlined in amber, then the result **jumps** in.

You never write any of this.

## Ends and decisions

`ends` is what every copy must hold when the story is over. `{all: [...]}` for every lane that holds a copy, or one
entry per lane. The last frame of the player shows it.

A story whose answer is not settled has a `decision`:

```yaml
decision:
  question: "A deletion wins over typing made in the same cell. Who is to be protected?"
  options:
    - label: "The deletion wins"
      proposed: true                       # exactly one option is the proposed one
      detail: "The cell stays deleted and the typing goes with it."
      ends: [c0, c2]                       # optional: how the story ends under this option
    - label: "The typing is kept as a recovered copy"
      detail: "The cell comes back, marked as recovered."
      ends: [c0, "?c1 +B-TYPED=recovered", c2]
```

Each option is a card with a small picture of its ending. Clicking an option **plays that ending** in the windows
above. `decision.answerLabel` (set by your page builder) is the word on the proposed option: "Proposed" for an answer
that was taken for now, "Suggested" for one nobody has discussed.

## Player API

```js
NbScenario.mount(el, story, opts)     // draws and plays a story in `el`; returns {play, pause, seek(i), destroy}
NbScenario.mountAll(root, opts)       // mounts every <div data-nbs><script type="application/json">…</script></div>
NbScenario.triptych(el, panels, cfg)  // "the problem in one picture": static windows side by side
NbScenario.buildTimeline(story, cfg)  // pure: the frames of a story, for tests and tools
NbScenario.boardHTML(tl, frame, o)    // pure: the windows of one frame, as a string
NbScenario.miniHTML(cells, cfg)       // pure: a small static picture of a list of cells
```

`opts` for `mount`:

| option | default | |
|---|---|---|
| `config` | `{}` | `bank`, `rewrites`, `outputs`, `typingMs` (see above) |
| `autoplay` | `'visible'` | Play while at least a third of the story is on screen; `false` never plays by itself; `true` always plays. |
| `loop` | `true` | Start again after the end, while visible. |
| `reduced` | from `prefers-reduced-motion` | Draw the end of the story, static, and let the reader step through. |
| `answerLabel` | `'Proposed'` | The word on the proposed option of a decision. |

`panels` of `triptych`: `[{title, status, cells, active, editing, caption, lane}]`, where `status` is one of the
statuses above (`online`, `offline`, …).
