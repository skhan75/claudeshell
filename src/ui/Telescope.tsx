import React, { useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { theme } from "./theme.js";
import { Panel, SectionHeader } from "./chrome.js";
import { fuzzyFilter } from "../core/fuzzy.js";

export interface TelescopeItem {
  key: string;
  label: string;
  group?: string;
}

/**
 * A generic neovim-Telescope-style floating finder: a centered bordered panel
 * with an accent border, a title bar, a fuzzy query line, a two-pane body
 * (LEFT: filtered results with a highlighted selection + `›` marker; RIGHT: a
 * preview of the highlighted item) and a bottom hint line.
 *
 * Owns its own useInput (always active while mounted — callers gate mounting via
 * store.overlay). Colors read `theme.X` at render time so applyTheme() sticks.
 */
export function Telescope<T extends TelescopeItem>({
  title,
  items,
  onSelect,
  onClose,
  renderPreview,
  placeholder,
}: {
  title: string;
  items: T[];
  onSelect: (item: T) => void;
  onClose: () => void;
  renderPreview?: (item: T) => React.ReactNode;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);

  const filtered = fuzzyFilter(items, query, (i) => i.label);
  const clampedSel = Math.min(sel, Math.max(0, filtered.length - 1));
  const highlighted = filtered[clampedSel];

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.return) {
      if (highlighted) onSelect(highlighted);
      return;
    }
    if (key.upArrow || (key.ctrl && input === "p")) {
      setSel((s) => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow || (key.ctrl && input === "n")) {
      setSel((s) => Math.min(s + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setSel(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setSel(0);
    }
  });

  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const panelWidth = Math.min(termWidth - 8, 90);
  const resultsWidth = Math.max(18, Math.floor((panelWidth - 4) * 0.4));

  // Track group headers: only show one header per distinct group when groups differ.
  let lastGroup: string | undefined;
  const groupsDiffer = new Set(items.map((i) => i.group).filter(Boolean)).size > 1;

  return (
    <Box width={panelWidth} flexDirection="column">
      <Panel accent flexDirection="column">
        <Text bold color={theme.accent}>
          {title}
        </Text>
        <Text color={theme.accent}>
          {"❯ "}
          {query}
          {!query && placeholder ? <Text color={theme.dim}>{placeholder}</Text> : null}
          <Text color={theme.fg}>▋</Text>
        </Text>
        <Box flexDirection="row">
          {/* LEFT: results list */}
          <Box flexDirection="column" width={resultsWidth}>
            {filtered.length === 0 ? (
              <Text color={theme.dim}>no matches</Text>
            ) : (
              filtered.map((item, i) => {
                const showHeader = groupsDiffer && item.group && item.group !== lastGroup;
                lastGroup = item.group;
                const selected = i === clampedSel;
                const text = item.label.length > resultsWidth - 2 ? item.label.slice(0, resultsWidth - 3) + "…" : item.label;
                return (
                  <React.Fragment key={item.key}>
                    {showHeader ? <SectionHeader label={(item.group ?? "").toUpperCase()} width={resultsWidth} /> : null}
                    <Text inverse={selected} color={selected ? theme.accent : theme.dim}>
                      {selected ? "› " : "  "}
                      {text}
                    </Text>
                  </React.Fragment>
                );
              })
            )}
          </Box>
          {/* RIGHT: preview pane for the highlighted item */}
          <Box flexDirection="column" flexGrow={1} paddingLeft={2}>
            {highlighted ? (
              renderPreview ? (
                renderPreview(highlighted)
              ) : (
                <Text color={theme.fg}>{highlighted.label}</Text>
              )
            ) : (
              <Text color={theme.dim}>—</Text>
            )}
          </Box>
        </Box>
        <Text color={theme.dim}>↑↓ move · enter select · esc close</Text>
      </Panel>
    </Box>
  );
}
