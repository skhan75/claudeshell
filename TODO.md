# TODO / Parked work

Tracking deferred work and candidates. See `LOGBOOK.md` for the decisions behind these.

---

## 🅿️ Parked — the agent fleet (`/parallel` + `/swarm`)

**Status:** built, tested, committed — but **parked** (not a production headline). Do not invest
further until the case is stronger.

**Why parked:** the value is thin vs. Claude Code's built-in subagents (it already parallelizes
internally), and parallel *editing* has a file-collision problem that needs heavyweight isolation
(git worktrees / directory copies) — too much friction for the payoff. Full reasoning in
`LOGBOOK.md` (2026-06-14 "DECISION — park the agent fleet").

**If revived, the only shape worth building:** *fleet = thinking/comparing only, never edits.*
- `/swarm <task>` → N independent attempts at the SAME task → compare → user picks ONE. Zero
  collision risk (agents only propose), no worktree/copy machinery needed.
- Drop `/parallel`-for-editing entirely unless/until isolation is genuinely warranted.

**Open questions to settle before reviving:**
- [ ] Is user-controlled comparison of N attempts worth the UX surface, given Claude's internal subagents?
- [ ] Should fleet workers be *forbidden* from writing files (propose-only), making isolation moot?
- [ ] If editing is ever wanted: git-worktree isolation (needs a git repo) vs. dir-copy fallback
      (works anywhere, costlier, weaker merge) — tiered by whether the project is under git.

**Cleanup candidate (low-risk, reversible):** remove `/parallel` + `/swarm` from
`DEFAULT_SLASH_COMMANDS` and the HelpOverlay so they aren't advertised to users, while leaving the
engine in place. Keep `/fork` and the Ctrl+F/`/fleet` dashboard (both useful and collision-free).

---

## 🔭 Backlog — daily-driver candidates (not started)

Roughly prioritized; see chat 2026-06-14 for the rationale.

1. **Multi-line / paste-friendly composer** — the input is single-line today; pasting a stack
   trace or writing a detailed prompt is painful. Highest everyday impact.
2. **Reading experience** — markdown/code-block rendering quality in responses; verify the
   transcript line-build is memoized (rendering is already windowed, but lines are rebuilt every
   render → could lag in very long sessions).
3. **Robustness / SDK-drift hardening** — defensive handling so an unexpected SDK message shape
   degrades gracefully instead of crashing the tab ("flimsy" concern).
4. **Deepen `/review`** — commit from the UI, stage individual hunks; pairs with the editor
   satellite. Strongest "cockpit" story now that the fleet is parked.
5. **Distribution polish** — confirm `npm i -g` / `npx openshell` works end-to-end; flesh out
   the README + config docs.
