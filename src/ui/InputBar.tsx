import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { fuzzyFilter } from "../core/fuzzy.js";
import { listProjectFilesCached } from "../core/files.js";

export function InputBar() {
  const { manager, store } = useAppCtx();
  useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const [text, setText] = useState("");
  const session = manager.active;

  const slashCommands = (session?.transcript.meta.slashCommands ?? []).map((c) =>
    c.startsWith("/") ? c : "/" + c
  );
  const suggestions =
    text.startsWith("/") && !text.includes(" ")
      ? fuzzyFilter(slashCommands, text.slice(1), (c) => c.slice(1)).slice(0, 5)
      : [];

  const isActive = focus === "input" && !paletteOpen && !manager.active?.pendingPermission && session?.status !== "crashed";

  useInput(
    (input, key) => {
      if (key.return) {
        const t = text.trim();
        if (t !== "") session?.send(t);
        setText("");
        return;
      }
      if (key.tab) {
        if (text === "") {
          store.getState().setFocus("pills");
          return;
        }
        if (suggestions.length > 0) {
          setText(suggestions[0] + " ");
          return;
        }
        const words = text.split(" ");
        const lastWord = words[words.length - 1];
        if (lastWord.startsWith("@") && lastWord.length > 1 && session) {
          const matches = fuzzyFilter(listProjectFilesCached(session.cwd), lastWord.slice(1), (f) => f);
          if (matches.length > 0) {
            words[words.length - 1] = "@" + matches[0];
            setText(words.join(" ") + " ");
          }
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

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent}>❯ </Text>
        <Text color={theme.fg}>{text}</Text>
        {focus === "input" && <Text color={theme.accent}>▋</Text>}
        {text === "" && <Text dimColor> Enter prompt — Tab: pills · /: commands · @: files</Text>}
      </Box>
      {suggestions.length > 0 && (
        <Text dimColor>  {suggestions.join("   ")}</Text>
      )}
    </Box>
  );
}
