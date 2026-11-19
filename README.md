# Jupyter server-side documents: conformance

When two people edit the same notebook, what should they see? What if one of them loses their connection, the server
restarts, or a file changes underneath them? This project writes those situations down as short stories, and gives you a
command that checks whether your real-time collaboration backend does what the stories say.

<img src="docs/assets/conformance.gif" alt="jupyter conformance ssd: the welcome screen, choosing stories from a list, and seeing what each one needs from a backend" width="720">

You can use it two ways:

- **Check your backend.** Run the stories against it in real browsers and see which it meets.
- **Read the stories.** Every one is a short animation of what each copy of the notebook holds, step by step:
  [the stories, live](https://zsailer.github.io/jupyter-server-side-documents-conformance/).

## Install

You need [Node.js](https://nodejs.org) and a Python environment with the backend you want to check. Then:

```sh
npm install -g @zsailer/jupyter-server-side-documents-conformance
```

Check that it worked:

```sh
jupyter conformance ssd
```

You should see a welcome screen with a few things to try. The first time you run the tests, it sets itself up (it downloads
a browser for the tests to drive), which takes a few minutes. After that it starts straight away.

No install? Run it once with `npx`. There is no `jupyter` in front here, because `npx` runs the program directly:

```sh
npx @zsailer/jupyter-server-side-documents-conformance ssd run --backend jsd
```

## Run the tests

Run the command from the Python environment your backend is installed in, and say which backend it is:

```sh
jupyter conformance ssd run --backend jsd      # jupyter-server-documents
jupyter conformance ssd run --backend jcollab  # jupyter-collaboration
```

It starts a JupyterLab with your backend, plays every story in real browsers, stops the server, and tells you how it went.
The exit code is 0 when no story failed, so it works as a step in CI.

Not sure where to start? Pick stories from a list, or run just one:

```sh
jupyter conformance ssd pick --backend jsd       # choose stories from a list, then run them
jupyter conformance ssd run crash/dies-before-save --backend jsd   # run one story
jupyter conformance ssd list                     # see every story, and what each needs from a backend
```

If your backend is somewhere else, point at it: `--env <dir>` for a Python environment, `--url <address>` for a server that
is already running, or `--start "<command>"` for your own way to start one.

**Reading the results.** Each story ends in one of these: it passed, it failed, it is a known gap (it fails, and you have
said that is expected), it is a proposal that is not met yet (reported, never a failure), or it was skipped because your
backend cannot do something the story needs. The summary says which, and why.

Your backend can do more than the basics. A few stories need it to help the tests, for example to let go of a notebook on
request. That is a small, test-only contract. [Running against a backend](docs/running-against-a-backend.md) has all the
options, [the backend contract](docs/backend-contract.md) says what to add for the rest of the stories, and
[running in CI](docs/running-in-ci.md) has a ready-made GitHub Actions workflow.

## Contribute a story

A story is one situation: what people see when something happens to a shared notebook. If you think a situation is
missing, or that one of the answers is wrong, we would love your help.

1. **To change a story,** open it on [the site](https://zsailer.github.io/jupyter-server-side-documents-conformance/) and
   click **Edit this story on GitHub**. **To add one,** copy a similar story in [`stories/storyboards/`](stories/storyboards/)
   and mark it `status: proposed`.
2. Write it in plain words: who does what, in order, and what each copy of the notebook holds after each step. The
   [guide to a good scenario](docs/03-designing-a-good-scenario.md) shows how, and the
   [reference](docs/02-spec-reference.md) lists everything a story can say.
3. Open a pull request. A preview of the site is published on it, and it opens on just the story you added or changed, so
   everyone can look at the same thing and talk about it.

If the right answer is not agreed, add the options to the story and mark one as the proposal. The group can then decide
on the pull request, and a story can be listed on the "Up for discussion" page with a link to the conversation. Details
are in [CONTRIBUTING.md](CONTRIBUTING.md).

## More

- [The stories, live](https://zsailer.github.io/jupyter-server-side-documents-conformance/)
- [The player library and how the site is built](docs/library.md)
- [Contributing](CONTRIBUTING.md)

## License

[BSD 3-Clause](LICENSE).
