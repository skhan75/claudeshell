# Demo recording for openshell — produces demo/openshell.gif
# Regenerate with:  vhs demo/openshell.tape   (requires vhs, ffmpeg, ttyd, chrome)
Output "demo/openshell.gif"
Set Shell "zsh"
Set FontSize 13
Set Width 1320
Set Height 760
Set Theme "Catppuccin Mocha"
Set Padding 12
Set Framerate 24

Type "npm run dev"
Enter
Sleep 10s

# A real turn — streaming response (fills the conversation)
Type "In one short sentence, what is openshell?"
Enter
Sleep 13s

# Real Claude slash commands (loaded from the live CLI)
Type "/"
Sleep 2600ms
Backspace
Sleep 600ms

# @ file picker
Type "@"
Sleep 2400ms
Backspace
Sleep 600ms

# Command palette
Ctrl+K
Sleep 2400ms
Escape
Sleep 500ms

# Help overlay
Ctrl+G
Sleep 2400ms
Escape
Sleep 500ms

# Buffer switcher
Ctrl+B
Sleep 2000ms
Escape
Sleep 500ms

# New session tab
Alt+t
Sleep 2000ms
Sleep 1s
