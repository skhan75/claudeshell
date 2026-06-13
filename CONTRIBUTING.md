# Contributing to claudeshell

## Dev setup

```bash
npm install
npm run dev        # run the TUI from source via tsx
```

## Test commands

```bash
npm test                                        # run all test suites
npx vitest run tests/core/session.test.ts      # single file
npm run typecheck                               # tsc over src AND tests
```

## Conventions

**TDD:** write the failing test first, then implement until it passes, then commit.

**Commits:** conventional commits with scope — examples:
- `feat(core): add resume support`
- `fix(ui): correct scroll offset on resize`
- `test(ui): add palette keyboard navigation spec`
- `chore: update CI matrix`

Scopes: `core` for headless logic, `ui` for Ink components.

**ESM imports:** every relative import must end in `.js`, including in `.tsx` files.

**UI tests:** every UI test file must call `afterEach(cleanupInk)` (imported from
`tests/ui/helpers.tsx`) and `await tick()` around `stdin.write`. See CLAUDE.md for the
full constraint list including control-byte handling.

## PR expectations

- `npm test` passes (all suites green).
- `npm run typecheck` is clean (zero errors).
- New behaviour has a corresponding test.
- Commits follow the conventional-commits format above.
