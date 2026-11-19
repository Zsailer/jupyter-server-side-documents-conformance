---
name: write-a-case
description: Use when asked to propose, draft or change a user-experience case (a story) for real-time notebook collaboration in this repo. Writes the story YAML, checks it, and previews it, so a pull request can be only about the UX.
---

# Write a case

A case is one story in `stories/storyboards/*.yaml`: a few people (tabs), the server and the file, what happens step by
step, and how it ends. The page, the animation and the compliance test are all generated from it. You only write the
story. Do not hand-write tests, and do not edit anything under `compliance/tests/generated/` (it is not committed).

## Steps

1. **Ask for the one question the case answers**, in the author's words, if they have not given it. A case answers one
   question ("what happens to what I typed offline if the server rebuilds the notebook?"). If it answers two, make two
   cases. Read `docs/03-designing-a-good-scenario.md` before drafting.
2. **Pick the file.** Add the story to the group file whose subject is closest (`handshake`, `offline`, `rebuild`,
   `conflict`, `crash`, `files`, `history`, `outputs`, `shutdown`, `agent`). Name it `group/what-happens`: a few words
   (at most five, kebab-case) that say what happens, not what is checked, such as `crash/dies-before-save`. See which names
   are taken: `grep -ho '^  [a-z]*/[a-z0-9-]*:' stories/storyboards/*.yaml`.
3. **Write it** with the grammar of `docs/02-spec-reference.md` (lanes, steps with `at`/`kind`/`text`/`cells`, `result`,
   `ends`, optional `risk` and `decision`). Rules that matter:
   - Steps are sentences a person would say, in order of time. Show each lane's cells after the step, not only when they change at the end.
   - `ends` is what every copy holds at the end. It is what the test checks, so be exact: use real cell names (`c0`, `c1=+TYPED`).
   - If the right answer is not agreed, use `decision` with every option, exactly one marked `proposed`. Each option's ending is played.
4. **Mark it `status: proposed`** (a line in the story). A proposed case is shown on the page with a badge, and its test
   reports a miss instead of failing. Reviewers change it to `accepted` when the group agrees. Do not mark it accepted yourself.
5. **Check it:** `npm run check`. A story that is not well formed fails with a message naming it.
6. **Preview it:** the preview is published by CI when the pull request is open, and linked in a comment on it. Do not claim there is a preview until the link is there.
7. **Open a draft pull request** against `main` from the author's fork, following the template. The description is about
   the UX: the question, the proposed answer, the alternatives, and who needs to weigh in. It does not list files.

## What not to do

- Do not decide the open question for the group. Put the alternatives in `decision` and say which one you propose and why.
- Do not describe an implementation (rooms, Yjs, checkpoints). Say what a person sees. The case has to hold for any backend.
- Do not change another case's `ends` in the same pull request unless this case is about changing it, and say so.
