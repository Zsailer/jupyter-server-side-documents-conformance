"""Jupyter Server configuration for the conformance tests.

!! Never use this configuration in production: it opens the server to anyone who can reach it, and it gives the page
access to JupyterLab's JavaScript objects through the global `window`.

It is what the tests need of any Jupyter Server based backend:

- the server is set up the way JupyterLab's own UI tests set it up (no login, the app exposed to the page);
- when CONFORMANCE_CONTROL names a module in this folder, that module is loaded as a server extension. It is the
  backend's side of the control contract (docs/backend-contract.md), and it is what lets a test make the server let go
  of a notebook;
- the frontend extensions that open a blocking modal on load are switched off when they are installed.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

from jupyter_core.paths import jupyter_path
from jupyterlab.galata import configure_jupyter_server

configure_jupyter_server(c)  # noqa: F821 - `c` is the config object Jupyter provides

# CI containers run as root, which Jupyter Server refuses by default.
c.ServerApp.allow_root = True  # noqa: F821

control = os.environ.get("CONFORMANCE_CONTROL")
if control:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    c.ServerApp.jpserver_extensions = {control: True}  # noqa: F821

# JupyterLab reads labconfig/page_config.json from the config path on each page load, so a generated one is put first.
disabled = {}
for root in jupyter_path("labextensions"):
    scoped = Path(root) / "@vendor"
    if scoped.is_dir():
        disabled.update({f"@vendor/{p.name}": True for p in scoped.iterdir()})
if disabled:
    disabled["@jupyterlab/scheduler"] = True
    config_dir = Path(tempfile.mkdtemp(prefix="conformance-config-"))
    (config_dir / "labconfig").mkdir()
    (config_dir / "labconfig" / "page_config.json").write_text(json.dumps({"disabledExtensions": disabled}))
    os.environ["JUPYTER_CONFIG_PATH"] = os.pathsep.join(filter(None, [str(config_dir), os.environ.get("JUPYTER_CONFIG_PATH")]))
