#!/bin/sh
# Record the demo GIF of the README (docs/demo.tape) and, the first time, put it in the README.
#
#   npm run demo
set -e
cd "$(dirname "$0")/.."

if ! command -v vhs >/dev/null 2>&1; then
  echo "VHS records the GIF: brew install vhs" >&2
  exit 1
fi

mkdir -p docs/assets
vhs docs/demo.tape

# the README holds a marker until the first recording; after that the image is in
python3 -I - <<'EOF'
from pathlib import Path

readme = Path("README.md")
text = readme.read_text()
marker = "<!-- conformance-demo -->"
if marker in text:
    readme.write_text(text.replace(marker, "![Choosing stories and running one with the conformance command](docs/assets/conformance.gif)", 1))
    print("README.md now shows the GIF")
EOF
echo "docs/assets/conformance.gif is ready: look at it, then commit it"
