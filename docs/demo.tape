# The demo GIF of the README: `npm run demo` plays this in a real terminal and writes docs/assets/conformance.gif.
#
# It needs VHS (`brew install vhs`) and a Python environment with jupyter_server_documents:
#
#   JSD_ENV=/path/to/that/env npm run demo
#
# The run at the end starts a real server, so it takes about half a minute. Change a step and run it again: the GIF is
# always what the command does today.

Output docs/assets/conformance.gif

Set Shell "bash"
Set FontSize 14
Set Width 1100
Set Height 680
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

# `jupyter conformance` for the length of the demo, from this checkout (installed, Jupyter finds `jupyter-conformance`)
Hide
Type `jupyter() { if [ "$1" = conformance ]; then shift; node compliance/bin/conformance.mjs "$@"; else command jupyter "$@"; fi; }` Enter
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

# 1. Say hello: what is it, and where do I start?
Type "jupyter conformance"
Sleep 400ms
Enter
Sleep 6s
Hide
Type "clear" Enter
Show

# 2. Choose stories from a list, filtering by a word
Type "jupyter conformance pick"
Sleep 400ms
Enter
Sleep 1500ms
Type "/"
Type "offline"
Sleep 1s
Enter
Sleep 1s
Down 1
Sleep 500ms
Type "g"
Sleep 1500ms
Type "c"
Sleep 800ms
Type "q"
Sleep 800ms
Hide
Type "clear" Enter
Show

# 3. Run one story against a real server
Type "jupyter conformance pick"
Sleep 400ms
Enter
Sleep 1s
Type "/"
Type "z3"
Sleep 600ms
Enter
Sleep 600ms
Type " "
Sleep 800ms
Enter
Wait+Screen@120s /passed|failed/
Sleep 4s
