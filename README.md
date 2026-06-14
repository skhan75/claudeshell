# openshell

A visual terminal shell for [Claude Code](https://claude.com/claude-code): multi-session
tabs, interactive PTY terminals, live token/cost telemetry, MCP + host status, a fuzzy
command palette, a buffer switcher, and a saved-sessions picker — all inside your terminal.

## Screenshot

The frame below is the openshell idle state captured from a real boot (empty session,
sidebar layout): a status bar with the tab list, effective model, status, and clock at the
top; a bordered SESSION / CONTEXT / HOST sidebar on the right (model, token meter, cost,
permission mode, context files, host); a bordered prompt box; and a key-hint footer.

```
▌CLAUDESHE 1:can you tell me ho│ 2:new      MODEL            ·STATUS    ·22:10:0
L          man…                 session     claude-opus-4-8   idle
────────────────────────────────────────────────────────────────────────────────
                                                ╭──────────────────────────────╮
                                                │ SESSION ──────────────────── │
                                                │ MODEL claude-opus-4-8        │
                                                │ TAB   1/2                    │
                                                │ MSGS  0                      │
                                                │ TOKENS 0 in · 0 out          │
                                                │ ░░░░░░░░░░░░░░ 0%            │
                                                │ COST  $0.00 · 0 turns        │
                                                │ PERMS default                │
                                                │                              │
                                                │ CONTEXT ──────────────────── │
                                                │ (no files yet)               │
                                                │                              │
                                                │ HOST ─────────────────────── │
╭──────────────────────────────────────────────╮│                              │
│ ❯ PROMPT                       MODE: default ││                              │
│ ❯▋ Enter send · / commands · @ files · ↑↓    ││                              │
│   pick                                       ││                              │
╰──────────────────────────────────────────────╯│                              │
                                                ╰──────────────────────────────╯
⌗ workspace/openshell · MODE default · ^B buffers · ^G help · ^Q quit · Syste…
```

## Demo

![openshell demo](demo/openshell.gif)

A live session — streaming a turn, the `/` command picker (real Claude CLI commands)
and `@` file picker, the `Ctrl+K` command palette, the `Ctrl+G` help guide, the `Ctrl+B`
buffer switcher, and opening a new tab. Maintainers can re-record it with
`vhs demo/openshell.tape` (see [demo/README.md](demo/README.md)).

## Install

```bash
npm install -g openshell
cd your-project && openshell
```

Requires Node ≥ 20 and a logged-in Claude Code (`claude` then `/login`), or
`ANTHROPIC_API_KEY`.

## Keys

| Key | Action |
|---|---|
| `Ctrl+K` | Command palette (sessions, actions, pills, slash commands, history, model switching) |
| `Ctrl+O` | Toggle layout: sidebar ⇄ zen |
| `Alt+1..9` | Jump to session tab |
| `Alt+T` / `Alt+W` | New / close session |
| `Esc` | Toggle input ⇄ transcript scroll mode |
| `j k g G Ctrl+D Ctrl+U` | Scroll transcript (scroll mode) |
| `/` then `n/N` | Search transcript (scroll mode) |
| `Tab` | In the `/` or `@` picker: insert the highlighted command/file (`↑/↓` to choose) |
| `Ctrl+B` | Buffer switcher — a centered picker of all open tabs |
| `Ctrl+G` | Help — searchable keybinding guide |
| `Ctrl+R` | Saved sessions — resume a past session in a new tab |
| `Alt+\` | New interactive terminal tab (PTY); `Ctrl+\` is its leader inside a terminal |
| `Ctrl+Q` | Quit (tabs auto-save and reopen next launch) |
| `r` | Resume a crashed session |

macOS note: Alt shortcuts need "Use Option as Meta key" enabled in your terminal profile.

## Config

Global `~/.openshell/config.toml`, per-project `.openshell.toml` (project wins):

```toml
[layout]
default = "sidebar"   # or "zen"

[keys]
palette = "ctrl+k"

# Quick-action pills — canned prompts/commands surfaced in the Ctrl+K palette (pill: …)
[[pills]]
label  = "fix tests"
prompt = "Run the test suite and fix any failures"

[[pills]]
label = "commit"
slash = "/commit"
```

Key bindings support `ctrl+<letter>`, `alt+<letter>`, and `esc` forms.

### Model switching

Open the palette (`Ctrl+K`) and type `model:` to see available models. Selecting one
switches the active session to that model immediately for the next query.

The list of available models is configurable via the `models` key (top-level, not under
a section). Project config wins over global; falls back to the built-in defaults:

```toml
models = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]
```

Example — restrict to two models in your project `.openshell.toml`:

```toml
models = ["claude-opus-4-8", "claude-sonnet-4-6"]
```

## Themes

openshell ships with a built-in **cyberpunk** theme. You can create custom themes as
TOML files under `~/.openshell/themes/<name>.toml` and select one in your config.

### Theme keys

All seven keys accept 3- or 6-digit hex color values (e.g. `#fff` or `#4cc2ff`):

| Key | Role |
|---|---|
| `accent` | Primary highlight (tabs, input border, active elements) |
| `dim` | Muted / secondary text |
| `warn` | Warnings and cost budget alerts |
| `purple` | Model name, MCP server labels |
| `good` | Success indicators, tool `done` status |
| `bad` | Errors, crash state |
| `fg` | Default foreground text |

### Creating a theme

Create `~/.openshell/themes/solar.toml`:

```toml
accent  = "#b58900"
dim     = "#657b83"
warn    = "#cb4b16"
purple  = "#6c71c4"
good    = "#859900"
bad     = "#dc322f"
fg      = "#839496"
```

Then select it in `~/.openshell/config.toml`:

```toml
[theme]
name = "solar"
```

Any keys omitted from your theme file fall back to the cyberpunk defaults. Unknown keys
and invalid color values are silently ignored.

## Permission dialogs

When Claude wants to run a tool you'll get a dialog: `y` allow once, `a` always allow
(persists to `.claude/settings.local.json`), `n` deny with an optional reason. Claude's
clarifying questions render as selectable option lists.

## Status

Early-stage (v0.1) — APIs and config format may change. Contributions welcome; see
[CONTRIBUTING.md](./CONTRIBUTING.md).
