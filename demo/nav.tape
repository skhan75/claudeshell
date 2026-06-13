# claudeshell — blazing-fast navigation, tabs & sessions
Output "demo/nav.gif"
Set Shell "zsh"
Set FontSize 13
Set Width 1320
Set Height 760
Set Theme "Catppuccin Mocha"
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
Sleep 5s

# spin up tabs
Alt+t
Sleep 900ms
Alt+t
Sleep 900ms
# jump between tabs instantly
Alt+"1"
Sleep 800ms
Alt+"3"
Sleep 800ms
Alt+"2"
Sleep 900ms

# buffer switcher (Ctrl+B): fuzzy-jump across open tabs
Ctrl+B
Sleep 1900ms
Down
Sleep 700ms
Enter
Sleep 1200ms

# saved sessions (Ctrl+R): resume any past session
Ctrl+R
Sleep 2300ms
Down
Sleep 700ms
Down
Sleep 900ms
Escape
Sleep 800ms

# toggle layout: sidebar <-> zen
Ctrl+O
Sleep 1600ms
Ctrl+O
Sleep 1300ms

# command palette (Ctrl+K): everything, one fuzzy search away
Ctrl+K
Sleep 900ms
Type "model"
Sleep 1900ms
Escape
Sleep 1200ms
