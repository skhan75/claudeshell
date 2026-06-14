import type { AppCtx } from "./context.js";
import { routeSlash, type SlashAction } from "../core/slash-commands.js";

/**
 * Execute a parsed `SlashAction`'s side effect against the app context. This is the
 * ONE place a routed slash command becomes an action — both InputBar and the command
 * palette call it, so there is no duplicated per-command handling to drift.
 *
 * Returns `true` when the command was app-handled; `false` for `null` / `{kind:"send"}`
 * so the caller falls back to sending the raw text to the session (SDK skills, prompts).
 */
export function execSlash(action: SlashAction, ctx: AppCtx): boolean {
  if (!action || action.kind === "send") return false;
  const { manager, store } = ctx;
  switch (action.kind) {
    case "overlay":
      store.getState().setOverlay(action.overlay);
      return true;
    case "reset":
      manager.active?.reset();
      return true;
    case "compact":
      store.getState().setCompactFocus(action.focus);
      store.getState().setOverlay("compact");
      return true;
    // parallel / swarm / fork are wired in their feature phases (2 + 5); until then
    // they fall through to the session as a normal prompt.
    default:
      return false;
  }
}

/** Convenience: parse a raw input line and execute it. Returns true if app-handled. */
export function runSlashLine(line: string, ctx: AppCtx): boolean {
  return execSlash(routeSlash(line), ctx);
}
