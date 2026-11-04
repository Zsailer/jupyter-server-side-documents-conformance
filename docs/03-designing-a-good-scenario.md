# Designing a good scenario

The player makes any story *look* good. These are the choices that make a story *useful*. They came from building the
[storyboards page](../examples/storyboards/) and from reviewing what readers actually asked for.

## 1. One story, one question

Every story answers one question a reviewer could disagree about: *"what happens to typing when another person deletes
the cell?"*, not *"how does reconnecting work?"*. If the title needs "and", it is two stories.

Aim for **six to ten steps**. Past twelve, readers stop watching; split the story or cut the preamble.

## 2. Put the person first

The leftmost window is the one the reader identifies with. Make it `tab`, call it "Your tab", and make the first
thing that happens in it something a person does. Servers and files come after; they are consequences.

## 3. Let people act and the system react

Choose the `kind` honestly, because it decides how the step is drawn:

- A person typing, adding, moving, deleting: use `type`, `add`, `move`, `delete`. Their change is *typed*, with a cursor.
- The system merging, rebuilding, saving: use `note`, `rebuild`, `save`. The change *appears*, with a flash.

Mixing these up is the quickest way to make a scenario misleading. If a merge looks typed, readers think a person did it.

## 4. Show the blink as a blink

A reconnect, a rebuild and a crash are **moments**, not periods. In real life the person sees the old state, then,
almost at once, the new one. Drawing them with the same length as typing makes readers think something slow happens.

The player gives these kinds (`reconnect`, `rebuild`, `crash`) a short, amber step with no progress bar, and while it
is on screen it shows **what differs** (cells outlined amber, tagged *differs from the server* / *the server’s
version*). Then the result appears at once, with a ring around the window that changed.

When you write the story, give the reconnect its own step, and give the result its own step after it. Do not fold them
into one.

## 5. Make the ending checkable

- `ends` says what every copy holds. The last frame shows all the windows side by side, so "everyone ends with the
  same notebook" is something the reader checks with their eyes.
- `result` is one sentence: **what the product does**, in the present tense, about the person, not the code.
- `risk` is one sentence: **what someone would see if it went wrong**.

## 6. Use real-looking cells

`c0`, `c1`, `c2` become a pandas import, a read and a describe. That already reads as a notebook. When a story is
about a specific cell (`tests`, `docs`, `fixed`), put real code in `config.bank` / `config.rewrites`. A story whose cells
are `print("X-1")` is fine, but one that reads like analysis is easier to believe.

Keep cells to one or two lines. The point is the change, not the code.

## 7. Decisions: say what is open, show every ending

For an open question, give a `decision` and **play every option**:

- Exactly one option is `proposed`. A page that proposes nothing leaves the reader with homework.
- Give each option an `ends`. The reader should be able to click the alternative and watch the windows end that way.
- Label honestly: *Proposed* for an answer that was taken for now, *Suggested* for one that nobody has discussed.
- Write the `detail` as a consequence for a person, including the cost: "…the person who deleted the cell sees it
  again."

## 8. Write the steps as sentences a person would say

- Present tense, subject first: "reconnects and shares its typing".
- Name the thing in quotes when the text matters: types “+OFFLINE” into c1.
- One thing per step. "Loses its connection and types" is two steps.
- Keep implementation words out. Say "the server builds the notebook again from the file", not what data structure did it.

The text is not decoration: it is the caption, the transcript, the search index and the thing screen readers read.

## 9. Pace

| | |
|---|---|
| a step | 1–1.5 s, plus typing time (55 ms a character, at most 2.6 s) |
| a blip | about 1.3 s |
| the end | 3.4 s |
| a whole story | aim for under 25 s |

Readers can pause and click any step, so err on the side of brisk.

## 10. Do not

- Draw more than **five** windows. Past that the story needs a diagram, not a demo.
- Hide the ending. If the end of the story is "it depends", say what it depends on and make that a `decision`.
- Use it as a test. It shows intent. Keep any link to tests (which scenario plays which story) in your repo, not on the page.
- Animate for its own sake. Every motion should be a person typing, a thing arriving, or a blink.

## Checklist

- [ ] The title is one question, not two.
- [ ] The first window is the person's, and the first step is theirs.
- [ ] People's steps are `type` / `add` / `move` / `delete`; the system's are `note` / `rebuild` / `save`.
- [ ] A reconnect (or rebuild, crash) has its own step, followed by a step that shows the result.
- [ ] `result` and `risk` are one sentence each, about the person.
- [ ] `ends` is filled in, and the windows agree at the end (or the story says why not).
- [ ] An open question has one proposed option and an `ends` for every option.
- [ ] Six to ten steps. No more than five windows.
- [ ] The steps read well as plain text.
