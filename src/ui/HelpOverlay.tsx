import React from "react";
import { Box, Text } from "ink";
import { useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Telescope, type TelescopeItem } from "./Telescope.js";

interface HelpItem extends TelescopeItem {
  binding: string;
  desc: string;
}

/** Pretty-print a config binding ("ctrl+k") as a display chord ("Ctrl+K"). */
function chord(binding: string): string {
  return binding
    .split("+")
    .map((p) => {
      if (p === "esc") return "Esc";
      if (p.length === 1) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join("+");
}

/**
 * A keybinding guide built on Telescope. The configurable chords (palette,
 * layout, new/close session, focus toggle) are read from config.keys; the rest
 * are hardcoded to the real claudeshell bindings. Selecting an item is a no-op
 * (it is a reference card) other than closing.
 */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const { config } = useAppCtx();
  const k = config.keys;

  const items: HelpItem[] = [
    // Onboarding essentials first so they surface prominently.
    {
      key: "quit",
      group: "Onboarding",
      binding: chord("ctrl+q"),
      label: "Quit claudeshell",
      desc: "To quit, press Ctrl+Q (or Ctrl+C). Your tabs auto-save and reopen next launch.",
    },
    {
      key: "saved-sessions",
      group: "Onboarding",
      binding: chord("ctrl+r"),
      label: "Saved sessions",
      desc: "Press Ctrl+R to browse and resume past conversations for this project. Sessions auto-save per project; pick one to reopen it in a new tab.",
    },
    {
      key: "help",
      group: "Onboarding",
      binding: chord("ctrl+g"),
      label: "This help",
      desc: "Press Ctrl+G to open this keybinding guide any time.",
    },
    // Global
    {
      key: "palette",
      group: "Global",
      binding: chord(k.palette),
      label: "Command palette",
      desc: "Open the fuzzy command palette: switch tabs, change mode/model, run pills, search history.",
    },
    {
      key: "layout",
      group: "Global",
      binding: chord(k.layoutToggle),
      label: "Toggle layout",
      desc: "Switch between the sidebar layout and the distraction-free zen layout.",
    },
    {
      key: "new-session",
      group: "Global",
      binding: chord(k.newSession),
      label: "New session",
      desc: "Open a new session tab.",
    },
    {
      key: "close-session",
      group: "Global",
      binding: chord(k.closeSession),
      label: "Close session",
      desc: "Close the active session tab.",
    },
    {
      key: "switch-tab",
      group: "Global",
      binding: "Alt+1..9",
      label: "Switch to tab N",
      desc: "Jump straight to tab 1 through 9.",
    },
    {
      key: "cycle-tab",
      group: "Global",
      binding: "Ctrl+← / Ctrl+→",
      label: "Cycle tabs",
      desc: "Step to the previous / next tab (wraps around). The Alt-free way to flip through buffers when your terminal eats the Alt key.",
    },
    {
      key: "switch-buffer",
      group: "Global",
      binding: "Ctrl+B",
      label: "Switch buffer (open tabs)",
      desc: "Ctrl+B opens a centered picker of all open tabs (buffers); type to filter, ↑↓ to move, Enter to jump. The fast way to hop between sessions and terminals.",
    },
    {
      key: "new-terminal",
      group: "Global",
      binding: "Alt+\\",
      label: "New terminal",
      desc: "Open a terminal tab (or use the command palette). Inside a terminal, the Ctrl+\\ leader reaches claudeshell commands (b buffers, t term, c claude, w close, …).",
    },
    {
      key: "perm-modes",
      group: "Global",
      binding: "palette · mode: …",
      label: "Permission modes",
      desc: "The side panel's PERMS/MODE: default prompts before risky tools; plan is read-only planning (no edits/commands); acceptEdits auto-approves file edits; bypassPermissions runs everything without asking. Switch via the command palette (mode: …).",
    },
    // Chat / scroll
    {
      key: "page-scroll",
      group: "Chat / scroll",
      binding: "PgUp / PgDn",
      label: "Scroll the conversation (any time)",
      desc: "Page up/down through the transcript at any time — even while composing. No mode switch needed; a scrollbar appears on the right whenever there's more to see.",
    },
    {
      key: "focus-chat",
      group: "Chat / scroll",
      binding: chord(k.focusToggle),
      label: "Focus chat (scroll mode)",
      desc: "Press Esc to move focus from the input into the conversation for fine-grained vim-style scrolling (j/k, arrows, g/G, search).",
    },
    {
      key: "focus-input",
      group: "Chat / scroll",
      binding: "i",
      label: "Back to input",
      desc: "Press i to return focus from scroll mode back to the input bar.",
    },
    {
      key: "scroll",
      group: "Chat / scroll",
      binding: "j / k or ↑ / ↓",
      label: "Scroll the conversation",
      desc: "In scroll mode, j/k (or arrows) move line by line through the transcript.",
    },
    {
      key: "scroll-ends",
      group: "Chat / scroll",
      binding: "g / G",
      label: "Jump to top / bottom",
      desc: "g jumps to the top of the conversation, G to the bottom.",
    },
    {
      key: "halfpage",
      group: "Chat / scroll",
      binding: "Ctrl+D / Ctrl+U",
      label: "Half-page down / up",
      desc: "Scroll a half page at a time through the transcript.",
    },
    {
      key: "search",
      group: "Chat / scroll",
      binding: "/",
      label: "Search the conversation",
      desc: "Press / in scroll mode to search; n / N jump to the next / previous match; Esc clears the search.",
    },
    {
      key: "search-nav",
      group: "Chat / scroll",
      binding: "n / N",
      label: "Next / previous match",
      desc: "After a / search, n moves to the next match and N to the previous; Esc clears the search.",
    },
    // Input
    {
      key: "input-tab",
      group: "Input",
      binding: "Tab",
      label: "Complete",
      desc: "In the input bar, Tab inserts the highlighted command/file from the open / or @ picker.",
    },
    {
      key: "input-slash",
      group: "Input",
      binding: "/",
      label: "Slash commands",
      desc: "Type / at the start of the input to open the slash-command picker.",
    },
    {
      key: "input-at",
      group: "Input",
      binding: "@",
      label: "File mentions",
      desc: "Type @ to open the file picker and mention a file in your prompt.",
    },
    {
      key: "input-nav",
      group: "Input",
      binding: "↑ / ↓",
      label: "Navigate the picker",
      desc: "When a slash/file picker is open, ↑ / ↓ move the highlighted suggestion.",
    },
    {
      key: "input-enter",
      group: "Input",
      binding: "Enter",
      label: "Send / select",
      desc: "Enter sends your message — or selects the highlighted suggestion when a picker is open.",
    },
    // Session
    {
      key: "resume-crashed",
      group: "Session",
      binding: "r",
      label: "Resume a crashed tab",
      desc: "If a tab crashed, press r to resume that conversation.",
    },
    {
      key: "interrupt",
      group: "Session",
      binding: "Esc",
      label: "Interrupt a running turn",
      desc: "Press Esc while a turn is processing to interrupt it.",
    },
  ];

  return (
    <Telescope<HelpItem>
      title="HELP · KEYBINDINGS"
      items={items}
      placeholder="search keybindings…"
      onSelect={() => onClose()}
      onClose={onClose}
      renderPreview={(item) => (
        <Box flexDirection="column">
          <Text bold color={theme.accent}>
            {item.binding}
          </Text>
          <Text color={theme.dim}>{item.group}</Text>
          <Box marginTop={1}>
            <Text color={theme.fg}>{item.desc}</Text>
          </Box>
        </Box>
      )}
    />
  );
}
