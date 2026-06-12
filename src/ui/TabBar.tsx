import React from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";

const STATUS_GLYPH: Record<string, string> = {
  idle: "",
  processing: " ⚙",
  "awaiting-permission": " ⚠",
  "awaiting-input": " ?",
  crashed: " ✖",
};

export function TabBar() {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  return (
    <Box>
      <Text color={theme.accent} bold>
        ▌CLAUDESHELL{" "}
      </Text>
      {manager.sessions.map((s, i) => {
        const active = i === manager.activeIndex;
        return (
          <Text key={s.id} inverse={active} color={active ? theme.accent : theme.dim}>
            {` ${i + 1}:${s.title}${STATUS_GLYPH[s.status] ?? ""} `}
          </Text>
        );
      })}
    </Box>
  );
}
