# claudeshell

A visual terminal shell for [Claude Code](https://claude.com/claude-code): multi-session
tabs, live token/cost telemetry, MCP + host status, quick-action pills, and a command
palette — all inside your terminal.

## Install

```bash
npm install -g claudeshell
cd your-project && claudeshell
```

Requires Node ≥ 18 and a logged-in Claude Code (`claude` then `/login`), or
`ANTHROPIC_API_KEY`.

## Keys

| Key | Action |
|---|---|
| `Ctrl+K` | Command palette (sessions, actions, pills, slash commands, history) |
| `Ctrl+O` | Toggle layout: sidebar ⇄ zen |
| `Alt+1..9` | Jump to session tab |
| `Alt+T` / `Alt+W` | New / close session |
| `Esc` | Toggle input ⇄ transcript scroll mode |
| `j k g G Ctrl+D Ctrl+U` | Scroll transcript (scroll mode) |
| `/` then `n/N` | Search transcript (scroll mode) |
| `Tab` | Autocomplete `/commands` and `@files`; from empty input: focus pills |
| `r` | Resume a crashed session |

macOS note: Alt shortcuts need "Use Option as Meta key" enabled in your terminal profile.

## Config

Global `~/.claudeshell/config.toml`, per-project `.claudeshell.toml` (project wins):

```toml
[layout]
default = "sidebar"   # or "zen"

[keys]
palette = "ctrl+k"

[[pills]]
label  = "fix tests"
prompt = "Run the test suite and fix any failures"

[[pills]]
label = "commit"
slash = "/commit"
```

Key bindings support `ctrl+<letter>`, `alt+<letter>`, and `esc` forms.

## Permission dialogs

When Claude wants to run a tool you'll get a dialog: `y` allow once, `a` always allow
(persists to `.claude/settings.local.json`), `n` deny with an optional reason. Claude's
clarifying questions render as selectable option lists.

## Status

Early-stage (v0.1) — APIs and config format may change. Contributions welcome; see
[CONTRIBUTING.md](./CONTRIBUTING.md).
