# claudeshell demo assets

This directory contains demo assets for the claudeshell README.

## Generating the GIF

The animated demo GIF is produced with [VHS](https://github.com/charmbracelet/vhs)
by charmbracelet — the standard terminal-GIF recorder.

### 1. Install VHS

**macOS (Homebrew):**

```bash
brew install vhs
```

**Go install (any platform):**

```bash
go install github.com/charmbracelet/vhs@latest
```

VHS also requires `ffmpeg` and `ttyd` (installed automatically by Homebrew; install
manually if using Go):

```bash
brew install ffmpeg ttyd   # macOS
```

### 2. Prepare the repo

Make sure dependencies are installed and the project builds:

```bash
npm install
```

### 3. Record the GIF

Run the tape from the **repo root**:

```bash
vhs demo/claudeshell.tape
```

This produces `demo/claudeshell.gif`. The tape:
- Boots the TUI with `npm run dev`
- Sends a short prompt and waits for a response
- Opens the command palette (`Ctrl+K`), the help overlay (`Ctrl+G`),
  the buffer switcher (`Ctrl+B`), and creates a new session tab (`Alt+t`)
- Total runtime: ~20 seconds of recording

### 4. Commit the GIF

Once generated, commit `demo/claudeshell.gif` alongside any tape changes so
the README image stays up to date:

```bash
git add demo/claudeshell.gif demo/claudeshell.tape
git commit -m "docs: update demo gif"
```

## Updating the tape

Edit `demo/claudeshell.tape` and re-run `vhs demo/claudeshell.tape`. The tape
uses [VHS syntax](https://github.com/charmbracelet/vhs#vhs-command-reference):
`Type`, `Enter`, `Sleep`, `Ctrl+<key>`, `Alt+<key>`, `Escape`, etc.
