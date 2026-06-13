import React from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Telescope, type TelescopeItem } from "./Telescope.js";
import type { Tab } from "../core/session-manager.js";

interface BufferItem extends TelescopeItem {
  tab: Tab;
  active: boolean;
}

/** Last two path segments of a cwd, e.g. /a/b/c/d → c/d. */
function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || "/";
}

/**
 * A centered Telescope-style picker of the OPEN tabs (buffers) — the
 * blazing-fast switcher. Open it, fuzzy-type a few chars (or arrow), Enter to
 * jump. Each item is `${i + 1}: ${title}` with a kind/status hint; the active
 * tab is marked with a `●` prefix and "(active)". Terminal tabs carry a
 * `$ term` badge.
 *
 * onSelect resolves the tab's live index in manager.tabs and activates it.
 */
export function BuffersOverlay({ onClose }: { onClose: () => void }) {
  const { manager } = useAppCtx();
  // Re-read on every store bump so titles/statuses stay live while open.
  useApp((s) => s.version);

  const activeIndex = manager.activeIndex;
  const items: BufferItem[] = manager.tabs.map((tab, i) => {
    const active = i === activeIndex;
    const hint =
      tab.kind === "terminal" ? `$ term ${tab.status}` : tab.status;
    const label = `${active ? "● " : ""}${i + 1}: ${tab.title} [${hint}]${active ? " (active)" : ""}`;
    return { key: tab.id, label, tab, active };
  });

  return (
    <Telescope<BufferItem>
      title="BUFFERS · OPEN TABS"
      items={items}
      placeholder="search open tabs…"
      onSelect={(item) => {
        const index = manager.tabs.findIndex((t) => t.id === item.tab.id);
        if (index !== -1) manager.activate(index);
        onClose();
      }}
      onClose={onClose}
      renderPreview={(item) => {
        const tab = item.tab;
        const isTerm = tab.kind === "terminal";
        const messages = isTerm ? null : tab.transcript.blocks.length;
        return (
          <Box flexDirection="column">
            <Text bold color={theme.accent}>
              {tab.title}
              {item.active ? <Text color={theme.good}> (active)</Text> : null}
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.dim}>
                kind <Text color={theme.fg}>{isTerm ? "terminal" : "claude"}</Text>
              </Text>
              <Text color={theme.dim}>
                cwd <Text color={theme.fg}>{shortCwd(tab.cwd)}</Text>
              </Text>
              <Text color={theme.dim}>
                status <Text color={theme.fg}>{tab.status}</Text>
              </Text>
              {messages !== null ? (
                <Text color={theme.dim}>
                  messages <Text color={theme.fg}>{String(messages)}</Text>
                </Text>
              ) : null}
            </Box>
          </Box>
        );
      }}
    />
  );
}
