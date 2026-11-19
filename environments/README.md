# Environments

Ready-made Python environments to run the conformance suite against a backend that is not jupyter-server-documents.

| folder | backend | `--backend` |
|---|---|---|
| [`jupyter-collaboration/`](jupyter-collaboration/) | jupyter-collaboration (`jupyter-server-ydoc`) with jupyter-server-nbmodel | `jcollab` |

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
