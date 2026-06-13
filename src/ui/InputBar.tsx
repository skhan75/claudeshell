import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Panel } from "./chrome.js";
import { fuzzyFilter } from "../core/fuzzy.js";
import { listProjectFilesCached } from "../core/files.js";

export function InputBar() {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const [text, setText] = useState("");
  // Selection index into the currently-shown suggestion list (whichever picker
  // is active). Reset to 0 whenever the query changes so it never dangles past
  // the end of a shrunk list.
  const [sel, setSel] = useState(0);
  // When set, the user pressed Esc to dismiss a picker; suppress suggestions
  // until the query changes again (so the next Enter sends normally).
  const [dismissed, setDismissed] = useState(false);
  const session = manager.active;
  const focused = focus === "input";

  // Slash source is the real CLI command list the SDK reports on the session's
  // transcript meta (populated eagerly). Normalize each entry to a leading "/".
  const slashCommands = (session?.transcript.meta.slashCommands ?? []).map((c) =>
    c.startsWith("/") ? c : "/" + c
  );
  const slashSuggestions =
    !dismissed && text.startsWith("/") && !text.includes(" ")
      ? fuzzyFilter(slashCommands, text.slice(1), (c) => c.slice(1)).slice(0, 5)
      : [];

  // Live @-file picker: the current word (last space-separated token); if it
  // starts with "@", surface matching project files as the user types — even on
  // a bare "@" (word.slice(1) === "" → fuzzyFilter returns all → first 8).
  const words = text.split(" ");
  const currentWord = words[words.length - 1];
  const atActive = !dismissed && currentWord.startsWith("@") && !!session;
  const fileSuggestions = atActive
    ? fuzzyFilter(listProjectFilesCached(session!.cwd), currentWord.slice(1), (f) => f).slice(0, 8)
    : [];

  // Unified picker model: at most one is visible at a time. @ takes precedence
  // when the current word is an @-token; otherwise the slash picker. The same
  // sel/Up/Down/Enter/Tab logic drives both — only the insertion differs.
  type Picker = "file" | "slash";
  const picker: Picker | null =
    fileSuggestions.length > 0 ? "file" : slashSuggestions.length > 0 ? "slash" : null;
  const suggestions = picker === "file" ? fileSuggestions : picker === "slash" ? slashSuggestions : [];
  // Clamp the rendered/selected index defensively (a stale sel from before a
  // keystroke could otherwise point past a freshly-shrunk list mid-render).
  const selIdx = suggestions.length > 0 ? Math.min(sel, suggestions.length - 1) : 0;

  const isActive =
    focused &&
    !paletteOpen &&
    !manager.active?.pendingPermission &&
    session?.status !== "crashed";

  // Replace text with a new value as a fresh query; reset selection.
  const setQuery = (next: string) => {
    setText(next);
    setSel(0);
    setDismissed(false);
  };

  // Insert the highlighted suggestion into the input, replacing the active
  // token, and append a trailing space (which dismisses the picker naturally).
  const insertSelected = () => {
    if (picker === "file") {
      const ws = text.split(" ");
      ws[ws.length - 1] = "@" + suggestions[selIdx];
      setQuery(ws.join(" ") + " ");
    } else if (picker === "slash") {
      setQuery(suggestions[selIdx] + " ");
    }
  };

  useInput(
    (input, key) => {
      // While a picker is open it owns navigation + Enter/Tab/Esc.
      if (picker) {
        if (key.upArrow || (key.ctrl && input === "p")) {
          setSel((s) => Math.max(0, Math.min(s, suggestions.length - 1) - 1));
          return;
        }
        if (key.downArrow || (key.ctrl && input === "n")) {
          setSel((s) => Math.min(suggestions.length - 1, s + 1));
          return;
        }
        if (key.return || key.tab) {
          insertSelected();
          return;
        }
        if (key.escape) {
          // Dismiss the picker without sending; the next Enter sends normally.
          setDismissed(true);
          return;
        }
        // Fall through to text editing for any other key (backspace/printable).
      }

      if (key.return) {
        const t = text.trim();
        if (t !== "") session?.send(t);
        setText("");
        setSel(0);
        setDismissed(false);
        return;
      }
      if (key.tab) {
        // No picker is open here (the picker branch above already consumed Tab).
        // Complete the active @/slash token if one is present; otherwise do nothing.
        if (picker) insertSelected();
        return;
      }
      if (key.backspace || key.delete) {
        setText((t) => t.slice(0, -1));
        setSel(0);
        setDismissed(false);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setText((t) => t + input);
        setSel(0);
        setDismissed(false);
      }
    },
    { isActive }
  );

  const mode = session?.permissionMode ?? "default";

  return (
    <Box flexDirection="column">
      <Panel accent={focused}>
        <Box justifyContent="space-between">
          <Text color={theme.dim} bold>
            ❯ PROMPT
          </Text>
          <Text color={theme.dim}>
            MODE: <Text color={theme.purple}>{mode}</Text>
          </Text>
        </Box>
        <Box>
          <Text color={theme.accent}>❯ </Text>
          <Text color={theme.fg}>{text}</Text>
          {focused && <Text color={theme.accent}>▋</Text>}
          {text === "" && (
            <Text dimColor> Enter send · / commands · @ files · ↑↓ pick</Text>
          )}
        </Box>
      </Panel>
      {picker === "slash" && (
        <Box flexDirection="column" paddingX={1}>
          {suggestions.map((s, i) => (
            <Text key={s} color={i === selIdx ? theme.accent : theme.dim} inverse={i === selIdx}>
              {i === selIdx ? "› " : "  "}
              {s}
            </Text>
          ))}
        </Box>
      )}
      {picker === "file" && (
        <Box flexDirection="column" paddingX={1}>
          <Text color={theme.dim}>@ files</Text>
          {suggestions.map((f, i) => (
            <Text key={f} color={i === selIdx ? theme.accent : theme.dim} inverse={i === selIdx}>
              {i === selIdx ? "› " : "  "}
              {f}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
