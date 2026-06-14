import React from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Telescope, type TelescopeItem } from "./Telescope.js";
import type { CompactMode } from "../core/session-manager.js";

interface CompactItem extends TelescopeItem {
  mode: CompactMode;
  desc: string;
}

const ITEMS: CompactItem[] = [
  {
    key: "new-tab",
    label: "New tab — keep the original",
    mode: "new-tab",
    desc: "Summarize, then continue in a fresh tab seeded with the summary. The full original conversation stays as its own tab — nothing is lost.",
  },
  {
    key: "replace",
    label: "Replace — condense this conversation",
    mode: "replace",
    desc: "Summarize, then reset THIS tab's context to the summary (like the CLI's /compact). The verbose history is dropped from view.",
  },
  {
    key: "summary",
    label: "Summary only",
    mode: "summary",
    desc: "Just generate and show a summary inline. No reset, no reclaimed context — informational.",
  },
];

/**
 * The /compact picker. The SDK has no native compaction, so openshell emulates it:
 * Claude summarizes the conversation (one real turn), then the chosen mode reseeds a
 * fresh context with the summary — reclaiming the context window. Opened by /compact;
 * the optional focus typed after the command steers the summary.
 */
export function CompactOverlay({ onClose }: { onClose: () => void }) {
  const { manager } = useAppCtx();
  const focus = useApp((s) => s.compactFocus);
  return (
    <Telescope<CompactItem>
      title="COMPACT CONVERSATION"
      items={ITEMS}
      placeholder="how to compact…"
      onClose={onClose}
      onSelect={(it) => {
        manager.requestCompact(it.mode, focus);
        onClose();
      }}
      renderPreview={(it) => (
        <Box flexDirection="column">
          <Text bold color={theme.accent}>{it.label}</Text>
          <Box marginTop={1}>
            <Text color={theme.fg}>{it.desc}</Text>
          </Box>
          {focus ? (
            <Box marginTop={1}>
              <Text color={theme.dim}>Focus: {focus}</Text>
            </Box>
          ) : null}
        </Box>
      )}
    />
  );
}
