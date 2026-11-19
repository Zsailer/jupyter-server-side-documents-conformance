# Environments

Ready-made Python environments to run the conformance suite against a backend that is not jupyter-server-documents.

| folder | backend | `--backend` |
|---|---|---|
| [`jupyter-collaboration/`](jupyter-collaboration/) | jupyter-collaboration (`jupyter-server-ydoc`) with jupyter-server-nbmodel | `jcollab` |
| [`jupyverse/`](jupyverse/) | jupyverse with its collaboration plugins (no login) | `jupyverse` |

## jupyter-collaboration

```sh
cd environments/jupyter-collaboration && uv sync && cd ../..
node compliance/bin/conformance.mjs run --backend jcollab --env environments/jupyter-collaboration/.venv
```

That starts JupyterLab with the suite's own server config and its side of the control contract
([`compliance/server/jcollab_control.py`](../compliance/server/jcollab_control.py)), runs the stories, and stops it.
jupyter-server-nbmodel adds server-side execution to the same rooms, so it needs nothing of its own.

A story this backend does not meet because it made a different decision is listed with the reason in
[`compliance/known-gaps/jcollab.json`](../compliance/known-gaps/jcollab.json), and the run stays green while it is open.

## jupyverse

```sh
cd environments/jupyverse && uv sync && cd ../..
node compliance/bin/conformance.mjs run --backend jupyverse --env environments/jupyverse/.venv
```

jupyverse is not built on Jupyter Server, so it starts differently: the suite runs
[`compliance/server/jupyverse_control.py`](../compliance/server/jupyverse_control.py) with the environment's Python, from
the folder it serves. That script starts jupyverse with collaboration on and adds one module of its own, which serves the
control contract and exposes the app to the page. Nothing is installed into the environment.

It also smooths over three things that have nothing to do with the stories, only with the tests setting themselves up:
it does not offer anycorn's zero-copy file sending (it fails on large files), it makes the folders Galata asks for, and it
gives a save of the Contents API the `path` its body needs. The environment includes `jupyterlab` only for Galata's page
helpers, which ship in that package.

A story this backend does not meet is listed with the reason in
[`compliance/known-gaps/jupyverse.json`](../compliance/known-gaps/jupyverse.json).
