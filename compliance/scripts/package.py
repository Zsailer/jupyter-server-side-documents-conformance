#!/usr/bin/env python3
"""Build the package other repos run the compliance tests from.

    python3 -I compliance/scripts/package.py            # writes dist/jupyter-server-side-documents-conformance-<version>.tgz

The tests are generated from stories/, not committed, so what a consumer needs is a snapshot of them: the generated tests,
the runtime and the adapters, the Playwright config and the scripts that start a server and summarize a run. The version
is the one in the root package.json; the release pipeline bumps it.

Playwright does not compile TypeScript inside node_modules, so the `jupyter conformance` command unpacks the package into a cache
the first time it runs from there.

    npx @jupyter-ai-contrib/jupyter-server-side-documents-conformance run     # unpacks itself into a cache on first use

"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
COMPLIANCE = HERE.parent
ROOT = COMPLIANCE.parent
NAME = "@jupyter-ai-contrib/jupyter-server-side-documents-conformance"

# what goes in, relative to compliance/
COPY = [
    "adapters",
    "bin",
    "runtime",
    "known-gaps",
    "server",
    "scripts/summarize.py",
    "playwright.config.ts",
    "tsconfig.json",
    "stories.json",
    "COVERAGE.md",
    "README.md",
]


def build(out: Path, stage: Path) -> Path:
    version = json.loads((ROOT / "package.json").read_text())["version"]
    subprocess.run([sys.executable, "-I", str(COMPLIANCE / "generate.py")], check=True, cwd=COMPLIANCE, stdout=subprocess.DEVNULL)

    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    for rel in COPY:
        src = COMPLIANCE / rel
        dst = stage / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules", "*.map", "__pycache__", "*.pyc"))
        else:
            shutil.copy2(src, dst)
    shutil.copytree(COMPLIANCE / "tests" / "generated", stage / "tests" / "generated")

    own = json.loads((COMPLIANCE / "package.json").read_text())
    package = {
        "name": NAME,
        "version": version,
        "description": own["description"],
        "bin": {"jupyter-conformance": "bin/conformance.mjs"},
        "publishConfig": {"access": "public"},
        "scripts": {"test": "playwright test", "typecheck": "tsc --noEmit"},
        "dependencies": own["devDependencies"],
    }
    (stage / "package.json").write_text(json.dumps(package, indent=2) + "\n")

    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(["npm", "pack", "--silent", "--pack-destination", str(out)], check=True, cwd=stage, stdout=subprocess.DEVNULL)
    packed = out / f"jupyter-ai-contrib-{NAME.split('/')[1]}-{version}.tgz"
    # the registry path wants the name without the scope's prefix, as the other extensions do
    final = out / f"{NAME.split('/')[1]}-{version}.tgz"
    packed.replace(final)
    return final


def main() -> None:
    final = build(ROOT / "dist", ROOT / ".package")
    print(final.relative_to(ROOT))


if __name__ == "__main__":
    main()
