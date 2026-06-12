# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

claudeshell is a terminal TUI (Ink 5 + React 18, TypeScript ESM) that wraps Claude Code
via `@anthropic-ai/claude-agent-sdk`. Each session tab drives one SDK `query()` in
streaming-input mode; permission prompts surface as TUI dialogs through `canUseTool`.

Design spec: `docs/superpowers/specs/2026-06-12-claudeshell-design.md`
Implementation plan (task-by-task, with verified SDK contracts): `docs/superpowers/plans/2026-06-12-claudeshell.md`

## Commands

```bash
npm run dev          # run the TUI from source (tsx)
npm test             # vitest, all suites
npx vitest run tests/core/session.test.ts   # single file
npm run typecheck    # tsc over src AND tests (tsconfig.test.json)
npm run build        # tsc → dist/ (build excludes tests via base tsconfig)
```

## Architecture

Two strictly separated layers:

- **`src/core/`** — headless, no UI imports, fully unit-testable. `Session` wraps one SDK
  `query()` (injectable `QueryFn` for tests — never import the SDK directly in tests);
  `Transcript` reduces SDK messages into renderable blocks + usage; `SessionManager` owns
  tabs + persistence (`~/.claudeshell/state.json`).
- **`src/ui/`** — Ink components subscribing to a zustand vanilla store (`src/store.ts`).
  Core publishes via `manager.subscribe → store.bump()` (a version counter); components
  re-render off `useApp((s) => s.version)` and read manager state directly.

## Non-obvious constraints (learned the hard way — do not regress)

- **ESM/NodeNext: every relative import ends in `.js`**, including in `.tsx` files.
- **The installed SDK emits streaming partials as `{type:"stream_event"}` raw deltas**,
  not the documented `partial_assistant` accumulated shape. `Transcript.apply` handles
  BOTH. Don't remove either branch.
- **Daily-driver parity requires** `settingSources: ["user","project","local"]` and
  `systemPrompt: {type:"preset", preset:"claude_code"}` in Session options — without
  these the SDK loads neither CLAUDE.md nor user settings.
- **Tool results must be matched by `tool_use_id`** (parallel tool calls arrive as one
  user message with multiple tool_results).
- **Ink UI tests**: ink-testing-library renders share one stdin emitter. Every UI test
  file must `afterEach(cleanupInk)` (from `tests/ui/helpers.tsx`) and `await tick()`
  around `stdin.write`. Control keys are REAL bytes in test files (ESC=0x1b, ^O=0x0f,
  ^K=0x0b) — some editors/tools strip them; verify with `grep -cP '\x1b'` after editing.
- **Any `useInput` in a component must guard against modals**: include
  `!paletteOpen && !manager.active?.pendingPermission` in `isActive`, or keystrokes leak
  through dialogs.
- **`Usage.contextTokens` is replace-semantics** (last assistant message's window
  occupancy); `inputTokens`/`outputTokens` are cumulative spend. The sidebar context
  meter must use `contextTokens`.

## Process conventions

- TDD per task: failing test → implement → pass → commit. Review fixes land with a
  pinning regression test.
- Conventional commits (`feat(core):`, `fix(ui):`, `test(ui):`, `chore:`); one concern
  per commit; push to `origin main` after each task.
