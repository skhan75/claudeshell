import React from "react";
import { Box, Text, useStdout } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";

const STATUS_GLYPH: Record<string, string> = {
  idle: "",
  processing: " ⚙",
  "awaiting-permission": " ⚠",
  "awaiting-input": " ?",
  crashed: " ✖",
  // Terminal-tab statuses.
  running: " ▸",
  exited: " ✖",
};

/** Measure the display width of a single tab label string (without ANSI). */
function tabWidth(label: string): number {
  return label.length;
}

/**
 * Given the full list of sessions and the active index, compute a windowed
 * slice that fits within `availableWidth` columns.  Always includes the active
 * tab.  Returns the slice and left/right hidden counts for the overflow
 * indicators.
 */
export function computeTabWindow(
  tabs: Array<{ label: string }>,
  activeIndex: number,
  availableWidth: number,
): { start: number; end: number; hiddenLeft: number; hiddenRight: number } {
  if (tabs.length === 0) return { start: 0, end: 0, hiddenLeft: 0, hiddenRight: 0 };

  // Try to fit as many tabs as possible around activeIndex.
  // Reserve space for overflow indicators (worst case "‹9 " + " 9›" = 6 chars each side).
  let start = activeIndex;
  let end = activeIndex + 1; // exclusive
  let used = tabWidth(tabs[activeIndex].label);

  // Expand outward while there is room.
  let leftDone = start === 0;
  let rightDone = end === tabs.length;

  while (!leftDone || !rightDone) {
    if (!leftDone) {
      const w = tabWidth(tabs[start - 1].label);
      // Reserve 4 chars if there will still be hidden tabs on the left after adding this
      const reserveLeft = start - 1 > 0 ? 4 : 0;
      const reserveRight = end < tabs.length ? 4 : 0;
      if (used + w + reserveLeft + reserveRight <= availableWidth) {
        start--;
        used += w;
        if (start === 0) leftDone = true;
      } else {
        leftDone = true;
      }
    }
    if (!rightDone) {
      const w = tabWidth(tabs[end].label);
      const reserveLeft = start > 0 ? 4 : 0;
      const reserveRight = end + 1 < tabs.length ? 4 : 0;
      if (used + w + reserveLeft + reserveRight <= availableWidth) {
        end++;
        used += w;
        if (end === tabs.length) rightDone = true;
      } else {
        rightDone = true;
      }
    }
  }

  return {
    start,
    end,
    hiddenLeft: start,
    hiddenRight: tabs.length - end,
  };
}

export function TabBar({ width }: { width?: number } = {}) {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const { stdout } = useStdout();
  // App passes the actual space the tab strip gets (left column minus the status
  // block); fall back to the full terminal width for standalone/tests.
  const termWidth = width ?? stdout?.columns ?? 80;

  // Brand prefix: "▌OPENSHELL " = 13 chars
  const brandWidth = 13;
  const availableWidth = Math.max(10, termWidth - brandWidth);

  const tabs = manager.tabs.map((t, i) => ({
    // Terminal tabs are marked with a leading `$ ` so they read distinctly.
    label: ` ${i + 1}:${t.kind === "terminal" ? "$ " : ""}${t.title}${STATUS_GLYPH[t.status] ?? ""} `,
    session: t,
    index: i,
  }));

  const activeIndex = manager.activeIndex;

  const { start, end, hiddenLeft, hiddenRight } = computeTabWindow(
    tabs,
    Math.min(activeIndex, Math.max(0, tabs.length - 1)),
    availableWidth,
  );

  const slice = tabs.slice(start, end);

  return (
    <Box>
      <Text color={theme.accent} bold>
        ▌OPENSHELL{" "}
      </Text>
      {hiddenLeft > 0 && (
        <Text color={theme.dim}>{`‹${hiddenLeft} `}</Text>
      )}
      {slice.map(({ label, session, index }, i) => {
        const active = index === activeIndex;
        return (
          <React.Fragment key={session.id}>
            {i > 0 && <Text color={theme.dim}>│</Text>}
            <Text inverse={active} bold={active} color={active ? theme.accent : theme.dim}>
              {label}
            </Text>
          </React.Fragment>
        );
      })}
      {hiddenRight > 0 && (
        <Text color={theme.dim}>{` ${hiddenRight}›`}</Text>
      )}
    </Box>
  );
}
