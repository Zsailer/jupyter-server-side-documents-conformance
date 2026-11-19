#!/usr/bin/env python3
"""Install a backend from a branch, tag or commit instead of from PyPI. For the Environments workflow.

    python scripts/install_ref.py --pip env/bin/pip --backend jcollab --ref my-branch
    python scripts/install_ref.py --pip env/bin/pip --backend jupyverse --ref someone/jupyverse@their-branch

The ref is `<ref>` (in the backend's own repository) or `<owner>/<repo>@<ref>` (a fork), where <ref> is a branch, a tag
or a commit. It fetches that one commit and installs from the checkout, so a repository that holds several packages
(jupyter-collaboration, jupyverse) gets all of them from the same commit, and a package that has a frontend is built here
(it needs Node). One line says what was installed, for the run summary:

    - jcollab from jupyterlab/jupyter-collaboration@my-branch (0123abc)
"""
import argparse
import glob
import os
import re
import subprocess
import sys
import tempfile

# repository: the default `<owner>/<repo>`; packages: where its Python packages are, relative to the repository (a
# folder with a pyproject.toml; `*` stands for any folder); extras: the extras to ask of a package
BACKENDS = {
    "jsd": {"repository": "jupyter-ai-contrib/jupyter-server-documents", "packages": ["."], "extras": {}},
    "jcollab": {"repository": "jupyterlab/jupyter-collaboration", "packages": ["projects/*"], "extras": {}},
    "nbmodel": {"repository": "datalayer/jupyter-server-nbmodel", "packages": ["."], "extras": {}},
    # the root package and the plugins the environment uses (environments/jupyverse). Not every plugin: `auth` and
    # `noauth` both provide the same thing, and jupyverse stops at start-up when it finds both
    "jupyverse": {
        "repository": "jupyter-server/jupyverse",
        "packages": [".", *[f"plugins/{p}" for p in (
            "contents", "file_id", "file_watcher", "frontend", "jupyterlab", "kernel_subprocess", "kernels",
            "lab", "nbconvert", "noauth", "terminals", "yjs", "yrooms", "ystore_sqlite",
        )]],
        "extras": {".": "jupyterlab,noauth,collaboration"},
    },
}

REPOSITORY = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


def parse_ref(value, default_repository):
    """`<ref>` or `<owner>/<repo>@<ref>` as (repository, ref)."""
    value = value.strip()
    if "@" in value:
        repository, _, ref = value.partition("@")
        if not REPOSITORY.match(repository) or not ref:
            raise ValueError(f"'{value}' is not <ref> or <owner>/<repo>@<ref>")
        return repository, ref
    if not value or value.startswith("-") or " " in value:
        raise ValueError(f"'{value}' is not a branch, tag or commit")
    return default_repository, value


def packages_in(checkout, patterns):
    """The folders of a checkout that hold a Python package, in the order the patterns give them."""
    found = []
    for pattern in patterns:
        for folder in sorted(glob.glob(os.path.join(checkout, pattern))):
            if os.path.isfile(os.path.join(folder, "pyproject.toml")) and folder not in found:
                found.append(folder)
    return found


def requirement(checkout, folder, extras):
    extra = extras.get(os.path.relpath(folder, checkout))
    return f"{folder}[{extra}]" if extra else folder


def run(*command, cwd=None):
    # what a command prints is for the log: only the line that says what was installed goes to stdout
    subprocess.run(command, cwd=cwd, check=True, stdout=sys.stderr)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--pip", required=True, help="the pip of the environment to install into")
    parser.add_argument("--backend", required=True, choices=sorted(BACKENDS))
    parser.add_argument("--ref", required=True)
    args = parser.parse_args(argv)

    backend = BACKENDS[args.backend]
    repository, ref = parse_ref(args.ref, backend["repository"])
    checkout = tempfile.mkdtemp(prefix=f"{args.backend}-")
    # one commit of any ref (a branch, a tag or a sha): GitHub serves all three
    run("git", "init", "-q", checkout)
    run("git", "-C", checkout, "fetch", "-q", "--depth", "1", f"https://github.com/{repository}.git", ref)
    run("git", "-C", checkout, "checkout", "-q", "FETCH_HEAD")
    sha = subprocess.run(["git", "-C", checkout, "rev-parse", "--short=7", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()

    folders = packages_in(checkout, backend["packages"])
    if not folders:
        sys.exit(f"{repository}@{ref} has no Python package where {args.backend} keeps them: {', '.join(backend['packages'])}")
    # the checkout's own packages replace the released ones; what they need is taken from PyPI
    run(args.pip, "install", "--upgrade", *[requirement(checkout, f, backend["extras"]) for f in folders])
    print(f"- {args.backend} from {repository}@{ref} ({sha})")


if __name__ == "__main__":
    main()
