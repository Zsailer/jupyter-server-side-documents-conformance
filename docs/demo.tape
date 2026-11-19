# The demo GIF of the README: `npm run demo` plays this in a real terminal and writes docs/assets/conformance.gif.
#
# It needs VHS (`brew install vhs`). Nothing here starts a server, so it takes about a minute and needs no Python
# environment. Change a step and run it again: the GIF is always what the command does today.

Output docs/assets/conformance.gif

Set Shell "bash"
Set FontSize 14
Set LineHeight 1.2
Set Width 1100
Set Height 680
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

# `jupyter conformance ssd` for the length of the demo, from this checkout (installed, `jupyter` finds it on the PATH)
Hide
Type `jupyter() { shift; node compliance/bin/conformance.mjs "$@"; }` Enter
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

# 1. Say hello: what is it, and where do I start?
Type "jupyter conformance ssd"
Sleep 400ms
Enter
Sleep 6s
Hide
Type "clear" Enter
Show

# 2. Choose stories from a list, filtering by a word
Type "jupyter conformance ssd pick"
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

# 3. See what each story needs from a backend, without starting one
Type "jupyter conformance ssd list --group handshake"
Sleep 400ms
Enter
Sleep 6s
