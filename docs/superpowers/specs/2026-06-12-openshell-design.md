# openshell — Design Spec

**Date:** 2026-06-12
**Status:** Approved in brainstorm; pending implementation plan

## What it is

openshell is a terminal TUI (text user interface) that wraps Claude Code, giving it a
visual, dashboard-style front end: multi-session tabs, a live context/telemetry panel
(model, tokens, cost, MCP servers, host stats), quick-action pills, and fast keyboard
navigation — styled as a dark cyberpunk terminal dashboard.

It is both a **daily driver** (full parity with interactive Claude Code: permissions,
slash commands, MCP) and a **shareable open-source tool** (installable via npm, configurable,
works across terminals).

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Platform | True terminal TUI (runs in iTerm/Ghostty/tmux/SSH) |
| Stack | TypeScript + Ink (React for terminals) + Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) |
| Sessions | Multi-session tabs in v1 |
| Layouts | A: right sidebar (default) and C: zen mode (full-width chat + telemetry strip), runtime-switchable, default configurable |
| Host panel | Local machine stats only (no remote nodes in v1) |
| Pills | Shipped defaults + user-defined, global + per-project config |
| Navigation | Command palette, Alt+number tab switching, vim-style transcript navigation, transcript/history search |
| Config format | TOML (`~/.openshell/config.toml` global, `.openshell.toml` per project) |
| Distribution | npm (`npm install -g openshell`), Node ≥ 18 |

## Architecture

### Process model

One Node process runs the TUI. Each session tab owns one Agent SDK `query()` call in
**streaming input mode**; the SDK spawns and supervises a Claude Code subprocess per
session. Closing a tab ends its subprocess; sessions remain resumable later by session ID.
Quitting openshell persists tab state so the same tabs can be reopened (via SDK `resume`).

### Layers

**Core (headless — no UI imports, fully unit-testable):**

- `SessionManager` — create/close/switch sessions; persists tab state to
  `~/.openshell/state.json` (versioned schema).
- `Session` — wraps one `query()`. Owns:
  - the transcript model (append-only list of rendered message blocks),
  - status: `idle | processing | awaiting-permission | awaiting-input | crashed`
    (`awaiting-permission` = pending `canUseTool` decision; `awaiting-input` = Claude
    asked the user a question via `QuestionDialog`),
  - a `UsageTracker` fed by assistant-message `usage` and result-message
    `total_cost_usd` / `modelUsage` / `num_turns`,
  - the `canUseTool` callback wiring (see Permission flow),
  - `interrupt()`, `setPermissionMode()`, `setModel()` passthroughs.
- `SystemMonitor` — polls local host stats (hostname, OS, CPU/mem, uptime) every few
  seconds plus per-session cwd git branch.
- `ConfigLoader` — merges global TOML with per-project TOML (pills, theme, keybindings,
  default layout). Per-project pills merge over globals by label.

**UI (Ink/React):** components subscribe to a zustand store that core publishes into.

- `App` — shell, layout switcher, global key handling
- `TabBar` — sessions with status glyphs (processing spinner, permission badge)
- `ChatPane` — virtualized transcript (Ink has no native scrolling; we render a viewport
  window over the transcript model), markdown + diff rendering, streaming text
- `SidePanel` — context files, model/token/cost meters, MCP server status, host stats
  (layout A); `TelemetryStrip` is its one-line zen-mode equivalent
- `InputBar` — prompt input with slash-command/`@file` Tab-autocomplete
- `PillBar` — quick-action pills
- `CommandPalette` — fuzzy finder overlay
- Modal dialogs — `PermissionDialog`, `QuestionDialog` (for Claude's clarifying
  questions), `ConfirmDialog`

### Data flow

```
keystroke → InputBar → Session.send(user message)
  → SDK query() stream → SDKMessage events → Session updates transcript/usage
  → store update → Ink re-render

SDK canUseTool(toolName, input) → Session enqueues PermissionRequest in store
  → PermissionDialog renders → user answers (y/a/n)
  → resolves the callback promise → SDK continues/denies
```

### Metadata sources (all from the Agent SDK)

| Panel item | Source |
|---|---|
| Model, slash commands, account, MCP servers | `query.initializationResult()` / system init message |
| Tokens in/out, cache reads | per-assistant-message `usage` |
| Cost, turns, duration, per-model usage | result message `total_cost_usd`, `modelUsage`, `num_turns`, `duration_ms` |
| Context files | tool-use events referencing files (Read/Edit), aggregated per session |
| Host stats | `SystemMonitor` (Node `os` module + `git` subprocess) |

## Layouts

**A — sidebar (default):** tab bar top; chat ~70% left; right sidebar stacking
CONTEXT / SESSION (model, tokens, cost, MCP) / HOST; input + pill bar bottom-left.

**C — zen:** tab bar top; one-line telemetry strip (model · tokens bar · cost · MCP ·
branch); full-width chat; input + pills bottom. `Ctrl+O` toggles A ⇄ C at runtime.
Sidebar auto-collapses to zen below a minimum terminal width.

## Interaction model

### Keybindings (defaults; all rebindable in `[keys]` config)

| Key | Action |
|---|---|
| `Alt+1..9` | Jump to session tab N |
| `Alt+T` / `Alt+W` | New session / close session |
| `Ctrl+K` | Command palette |
| `Ctrl+O` | Toggle layout sidebar ⇄ zen |
| `Esc` | Toggle focus input ⇄ transcript scroll mode |
| `j/k`, `g/G`, `Ctrl+D/U` | Vim scrolling in scroll mode |
| `/` then `n/N` | Search current transcript (scroll mode) |
| `Tab` (in input) | Autocomplete slash commands and `@file` paths |
| `Tab` from empty input | Focus pill bar; arrows + Enter fire a pill |

### Command palette (`Ctrl+K`)

Fuzzy search across: session tabs; actions (new/resume session, toggle layout, switch
model, switch permission mode); pills; slash commands (live from SDK init result, so
plugins/custom commands appear automatically); cross-session history search.

### Pills

```toml
# ~/.openshell/config.toml (global) + .openshell.toml (per project)
[layout]
default = "sidebar"   # or "zen"

[[pills]]
label  = "fix tests"
prompt = "Run the test suite and fix any failures"

[[pills]]
label = "commit"
slash = "/commit"
```

A pill fires either a `prompt` string or a `slash` command into the focused session.
Shipped defaults: fix tests, explain, commit, review (overridable/removable in config).

### Permission flow

Sessions start in Claude Code's `default` permission mode; palette switches a session to
`plan` / `acceptEdits` / `bypassPermissions` live. `PermissionDialog` shows tool name +
input preview and offers: **y** allow once · **a** always allow (persists via SDK
permission updates) · **n** deny (with optional reason sent back to Claude).

## Error handling

- **Subprocess death** — tab enters `crashed` state with the error and an `r`-to-resume
  action (re-`query()` with `resume: sessionId`). The shell never exits with a tab.
- **Preflight** — startup verifies the `claude` binary exists and meets a minimum
  version; failures print install/upgrade instructions. Auth errors surface in-tab with
  a hint (`claude /login` or `ANTHROPIC_API_KEY`).
- **Terminal** — resize reflow; "terminal too small" guard below minimum dimensions;
  `SIGINT`/`SIGTERM` interrupts running sessions, persists state, restores the terminal.
- **State file** — versioned; corrupt `state.json` is backed up and recreated, never a
  boot failure.

## Testing

- **Core:** Vitest unit tests against a fake SDK — recorded `SDKMessage` fixture streams
  replay real flows (streaming text, permission round-trips, results with usage) with no
  network. Session state machine, usage tracking, config merging.
- **UI:** `ink-testing-library` render tests — transcript virtualization, dialogs,
  palette filtering.
- **E2E:** one smoke test driving the real `claude` CLI behind an env flag (skipped in
  CI without credentials).

## Packaging

npm package `openshell` with a `bin` entry. `npm install -g openshell`; run
`openshell` in any project directory. Node ≥ 18. Versioned config and state schemas.

## Out of scope for v1

- Remote node monitoring (SSH targets) — the v1 host panel is local-only
- Mouse support (keyboard-first; revisit after v1)
- Context-aware/dynamic pills
- Theming beyond the shipped dark cyberpunk palette (theme config keys reserved)
- Windows native terminal support (best-effort via WSL; first-class support post-v1)
