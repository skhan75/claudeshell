import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Panel } from "./chrome.js";
import { fuzzyFilter } from "../core/fuzzy.js";
import { listProjectFilesCached } from "../core/files.js";

export function InputBar() {
  const { manager, store } = useAppCtx();
  useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const [text, setText] = useState("");
  const session = manager.active;
  const focused = focus === "input";

  const slashCommands = (session?.transcript.meta.slashCommands ?? []).map((c) =>
    c.startsWith("/") ? c : "/" + c
  );
  const slashSuggestions =
    text.startsWith("/") && !text.includes(" ")
      ? fuzzyFilter(slashCommands, text.slice(1), (c) => c.slice(1)).slice(0, 5)
      : [];

  // Live @-file picker: the current word (last space-separated token); if it
  // starts with "@", surface matching project files as the user types — even on
  // a bare "@" (word.slice(1) === "" → fuzzyFilter returns all → first 8).
  const words = text.split(" ");
  const currentWord = words[words.length - 1];
  const atActive = currentWord.startsWith("@") && !!session;
  const fileSuggestions = atActive
    ? fuzzyFilter(listProjectFilesCached(session!.cwd), currentWord.slice(1), (f) => f).slice(0, 8)
    : [];

  const isActive =
    focused &&
    !paletteOpen &&
    !manager.active?.pendingPermission &&
    session?.status !== "crashed";

  useInput(
    (input, key) => {
      if (key.return) {
        const t = text.trim();
        if (t !== "") session?.send(t);
        setText("");
        return;
      }
      if (key.tab) {
        // @ takes precedence when the current word is an @-token.
        if (atActive && fileSuggestions.length > 0) {
          words[words.length - 1] = "@" + fileSuggestions[0];
          setText(words.join(" ") + " ");
          return;
        }
        if (text === "") {
          store.getState().setFocus("pills");
          return;
        }
        if (slashSuggestions.length > 0) {
          setText(slashSuggestions[0] + " ");
          return;
        }
        return;
      }
      if (key.backspace || key.delete) {
        setText((t) => t.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) setText((t) => t + input);
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
            <Text dimColor> Enter prompt — Tab: pills · /: commands · @: files</Text>
          )}
        </Box>
      </Panel>
      {slashSuggestions.length > 0 && (
        <Box paddingX={1}>
          <Text dimColor>{"  "}</Text>
          {slashSuggestions.map((s, i) => (
            <Text key={s} color={i === 0 ? theme.accent : theme.dim}>
              {i === 0 ? "" : "   "}
              {s}
            </Text>
          ))}
        </Box>
      )}
      {fileSuggestions.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          <Text color={theme.dim}>@ files</Text>
          {fileSuggestions.map((f, i) => (
            <Text key={f} color={i === 0 ? theme.accent : theme.dim}>
              {i === 0 ? "› " : "  "}
              {f}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
