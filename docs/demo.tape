# The demo GIF of the README: `npm run demo` plays this in a real terminal and writes docs/assets/conformance.gif.
#
# It needs VHS (`brew install vhs`). Nothing here starts a server, so it takes about a minute and needs no Python
# environment. Change a step and run it again: the GIF is always what the command does today.

Output docs/assets/conformance.gif

Set Shell "bash"
# Drawn at about twice the size it is shown at, so the text stays sharp when the README scales it down.
# That makes the terminal about 115 characters wide and 33 lines tall: room for the welcome screen and the picker.
Set FontSize 20
Set LineHeight 1.2
Set Width 1600
Set Height 1000
Set Padding 32
# A muted, neutral black (not a blue-tinted one), with the colours of a dark editor.
Set Theme {"name":"Muted black","black":"#1e1e1e","red":"#f14c4c","green":"#23d18b","yellow":"#f5f543","blue":"#3b8eea","magenta":"#d670d6","cyan":"#29b8db","white":"#e5e5e5","brightBlack":"#666666","brightRed":"#f14c4c","brightGreen":"#23d18b","brightYellow":"#f5f543","brightBlue":"#3b8eea","brightMagenta":"#d670d6","brightCyan":"#29b8db","brightWhite":"#ffffff","background":"#1e1e1e","foreground":"#d4d4d4","selection":"#264f78","cursor":"#d4d4d4"}
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
