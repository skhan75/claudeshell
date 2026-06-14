# LOGBOOK

A running, timestamped log of **critical decisions, notable changes, and resolved issues**.
Newest entries at the top. Keep each entry terse — a few bullets. This is the project's
memory across sessions; **read it at the start of work and append to it as you go.**

---

## 2026-06-14

### Shipped — Option C Phase 1: the editor satellite
- `SessionManager.openInEditor(file, line?, spawnFn?)` opens `$EDITOR`
  (`VISUAL ?? EDITOR ?? "vi"`) as a dedicated terminal tab — `+LINE` when a line is given —
  and **auto-closes** the tab when the editor process exits, returning to the prior tab.
- Reuses the existing PTY/`Terminal` infra: added `args`/`title` to `TerminalOpts`/`SpawnFn`.
- Wired into the explorer: Enter/→/l/Space on a FILE row → `onOpenFile` → `openInEditor`
  (folders still expand). New palette action `edit: open <file> in $EDITOR` (last context file).
- Tests: openInEditor (args/title/cwd, $VISUAL precedence, auto-close on exit); FileTree
  fires onOpenFile on a file but not a folder. 341 passing, typecheck clean.
- **Why:** delegate editing to the user's editor instead of rebuilding one in Ink — the
  core of the Option C thesis. Next: fleet dashboard + `/parallel` (Phase 2).

### Process — added this LOGBOOK
- Started `LOGBOOK.md`; `CLAUDE.md` now points here as required reading + a "keep it updated" rule.

### DECISION — pivot to Option C: the agent-fleet cockpit (editor as satellite)
- **Chosen** over (A) standalone-cockpit-only and (B) becoming a neovim plugin.
- **Thesis:** own multi-agent *orchestration* (mission control for a fleet of Claude agents);
  **delegate editing to the user's own `$EDITOR`/neovim** — never rebuild the editor in Ink,
  never live inside neovim.
- **Why:** "AI in your editor" is a red ocean (avante.nvim / codecompanion.nvim / claudecode.nvim).
  Parallel/async multi-agent orchestration is structurally hard for editor-centric tools (single
  editing surface) and is uniquely ours — the real "cursor defeator" wedge.
- **Cheap because:** `src/core/` is UI-agnostic, so this is a re-focus, not a rewrite. We delete the
  "be an editor" ambition, not the engine.
- **First step:** editor satellite — open files in `$EDITOR` at a line.
- Roadmap phases: (1) editor satellite, (2) fleet dashboard + background-task control + `/parallel`,
  (3) cost-guard / budgets, (4) review flow (diffs → approve → land), (5) fork/branch + `/swarm`.

### Shipped this session (condensed history)
- **SDK live capabilities**: `supportedModels`/`accountInfo`/`mcpServerStatus`/`reconnect`/`toggleMcpServer`
  wired (model picker + inspector use real data; MCP controls in palette); guarded against stale promises
  on crash/dispose. Replaces hardcoded model list.
- **Rich tool rendering**: Edit/Write/Bash render real diffs / content / command output from the SDK's
  structured tool input + result (not terse one-liners).
- **Slash commands made honest**: only advertise what works — `/model`, `/help`, `/clear`, `/compact`
  + the SDK's live skill/plugin commands. Dropped ~28 dead CLI-only commands (`/vim`, `/doctor`, …).
- **/compact**: emulation (summarize → reseed) with a runtime mode picker (new-tab / replace / summary).
- **/clear**: `Session.reset()` — fresh, non-resumed context.
- **Layout**: removed outer frame (full-bleed); full-height right inspector; full-width bottom status bar;
  header confined to the left.
- **Inspector**: AGENTS list (each session w/ live status), CACHE tokens, ACTIVE (queued/running), PLAN/AUTH.
- **Message queuing** with a visible queued count; **interactive file explorer** (Ctrl+E, keyboard nav,
  expand/collapse); **scrollable transcript** (PgUp/PgDn, scrollbar); prompt-box + composer redesign.
- Fixed: model showing `<synthetic>` (ignore SDK warmup placeholder).
