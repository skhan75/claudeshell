# claudeshell VHS tape
# Run from the repo root: vhs demo/claudeshell.tape
# Produces: demo/claudeshell.gif

Output demo/claudeshell.gif

Set FontSize 16
Set Width 1200
Set Height 750
Set Theme "Catppuccin Mocha"
Set Padding 16

# Boot the TUI
Type "npm run dev"
Enter
Sleep 3s

# Type a prompt and submit
Type "list the files in the current directory"
Enter
Sleep 2s

# Open command palette (Ctrl+K), browse, then close
Ctrl+K
Sleep 1s
Escape

# Open help overlay (Ctrl+G), view, then close
Ctrl+G
Sleep 1500ms
Escape

# Open buffer list (Ctrl+B), view, then close
Ctrl+B
Sleep 1s
Escape

# Create a new session tab (Alt+t)
Alt+t
Sleep 1s

Sleep 2s
