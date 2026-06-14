/**
 * The built-in CLI slash commands claudeshell ACTUALLY implements. The interactive
 * `claude` CLI has many more (/vim, /doctor, /config, /cost, /rewind, …) but those are
 * handled by the CLI's terminal UI, NOT the Agent SDK's query() — sending them does
 * nothing ("isn't available in this environment"). So we only advertise the ones we
 * wire to a real action here; the SDK's live `slash_commands` (agent skills/plugins
 * like /superpowers:*) merge in on top and genuinely work.
 *
 * Leading "/" included; kept alphabetical so the inline picker reads predictably.
 */
export const DEFAULT_SLASH_COMMANDS: string[] = ["/clear", "/help", "/model"];

/**
 * The slash commands to offer: the built-in Claude commands first (the familiar
 * /model, /compact, /clear, …), then the SDK's live list (custom + plugin/skill
 * commands like /superpowers:brainstorming), deduped. Merging means the built-ins
 * are always present even once a session's plugin commands load — the user sees both.
 */
export function effectiveSlashCommands(reported: readonly string[]): string[] {
  const live = reported.map((c) => (c.startsWith("/") ? c : "/" + c));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...DEFAULT_SLASH_COMMANDS, ...live]) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * Slash commands claudeshell handles itself (the SDK's `query()` does NOT process
 * CLI slash commands — sending `/model` just returns "isn't available"). These map a
 * command to an app overlay that does the real thing; callers run the overlay instead
 * of sending the text. (Values are a subset of the store's Overlay union.)
 */
export const APP_SLASH_OVERLAY: Record<string, "models" | "help"> = {
  "/model": "models",
  "/models": "models",
  "/help": "help",
};

