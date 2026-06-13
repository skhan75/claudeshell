# claudeshell — chat workflow: / commands, @ files, live streaming, scroll
Output "demo/chat.gif"
Set Shell "zsh"
Set FontSize 13
Set Width 1320
Set Height 760
Set Theme "Tokyo Night"
Set Padding 12
Set Framerate 24

Hide
Type "export HOME=/tmp/cs-demo-home CLAUDESHELL_HOST=acme-dev"
Enter
Type "export PATH=/tmp/cs-demo-bin:/opt/homebrew/bin:/Users/samiahmadkhan/.local/bin:$PATH"
Enter
Type "cd /tmp/cs-demo && clear"
Enter
Show

Type "claudeshell"
Enter
# warm up: the SDK init populates real slash commands, model, MCP
Sleep 8s

# "/" opens the real Claude CLI command picker (not a hardcoded list)
Type "/"
Sleep 1800ms
Down
Sleep 600ms
Down
Sleep 900ms
Backspace
Sleep 1000ms

# "@" opens the live project-file picker
Type "@"
Sleep 1800ms
Down
Sleep 600ms
Down
Sleep 900ms
Backspace
Sleep 1000ms

# type a real prompt and watch the turn stream live
Type "In two short sentences, pitch why a fast keyboard-driven terminal workflow makes developers more productive."
Sleep 1200ms
Enter
Sleep 15s

# Esc drops into scroll mode; j/k walk the transcript
Escape
Sleep 1000ms
Type "k"
Sleep 500ms
Type "k"
Sleep 500ms
Type "j"
Sleep 600ms
Type "g"
Sleep 900ms
Type "G"
Sleep 1200ms
# back to the input
Type "i"
Sleep 1200ms
