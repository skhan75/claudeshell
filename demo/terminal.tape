# claudeshell — sandboxed PTY terminal tabs with a tmux-style leader
Output "demo/terminal.gif"
Set Shell "zsh"
Set FontSize 13
Set Width 1320
Set Height 760
Set Theme "Catppuccin Macchiato"
Set Padding 12
Set Framerate 24

Hide
Type "export HOME=/tmp/cs-demo-home CLAUDESHELL_HOST=acme-dev"
Enter
Type "export PATH=/tmp/cs-demo-bin:/opt/homebrew/bin:/Users/samiahmadkhan/.local/bin:$PATH"
Enter
Type "export PS1='acme-dev %~ %# '"
Enter
Type "cd /tmp/cs-demo && clear"
Enter
Show

Type "claudeshell"
Enter
Sleep 5s

# Alt+\ spins up a real interactive PTY terminal in its own tab
Alt+`\`
Sleep 2500ms

# run real commands inside the sandboxed shell
Type "ls"
Enter
Sleep 1500ms
Type "git log --oneline -5"
Enter
Sleep 2000ms
Type "echo claudeshell terminal tab"
Enter
Sleep 1800ms

# Ctrl+\ is the tmux-style leader; press 1 to hop back to the Claude session
Ctrl+`\`
Sleep 1200ms
Type "1"
Sleep 1800ms

# leader again, t opens another terminal — buffers stack up instantly
Ctrl+`\`
Sleep 900ms
Type "b"
Sleep 2200ms
Escape
Sleep 1200ms
