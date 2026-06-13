import React from "react";
import { Box, Text } from "ink";
import { theme } from "./theme.js";

/**
 * Shared visual primitives for the cyberpunk chrome. Every panel/divider/chip
 * routes through these so the look stays consistent across components.
 *
 * Colors read `theme.X` at call time (default-param evaluation), so applyTheme()
 * at startup is reflected everywhere.
 */

export const PANEL_BORDER = "round" as const;
export const PILL_BG = "#1e2738";
export const INK_BG = "#0b0e14";

/** A boxed panel with a round border. Pass `accent` to highlight (focused) state. */
export function Panel({
  children,
  accent = false,
  flexGrow,
  width,
  height,
  flexDirection = "column",
}: {
  children: React.ReactNode;
  accent?: boolean;
  flexGrow?: number;
  width?: number;
  height?: number;
  flexDirection?: "row" | "column";
}) {
  return (
    <Box
      borderStyle={PANEL_BORDER}
      borderColor={accent ? theme.accent : theme.dim}
      flexDirection={flexDirection}
      flexGrow={flexGrow}
      width={width}
      height={height}
      paddingX={1}
    >
      {children}
    </Box>
  );
}

/**
 * A section header: an uppercase label embedded in a rule, e.g.
 * `── CONTEXT ─────────────────`. Optional right-aligned status text.
 */
export function SectionHeader({
  label,
  width = 28,
  color = theme.dim,
  right,
}: {
  label: string;
  width?: number;
  color?: string;
  right?: string;
}) {
  const rightLen = right ? right.length + 1 : 0;
  const fill = Math.max(0, width - label.length - rightLen - 3);
  return (
    <Text color={color}>
      <Text bold color={theme.accent}>
        {label}
      </Text>{" "}
      {"─".repeat(fill)}
      {right ? ` ${right}` : ""}
    </Text>
  );
}

/** A horizontal divider line. */
export function Rule({ width = 28, color = theme.dim }: { width?: number; color?: string }) {
  return <Text color={color}>{"─".repeat(Math.max(0, width))}</Text>;
}

/** A pill chip — accent background when active, muted otherwise. */
export function Pill({ label, active = false }: { label: string; active?: boolean }) {
  return active ? (
    <Text backgroundColor={theme.accent} color={INK_BG}>
      {` ${label} `}
    </Text>
  ) : (
    <Text backgroundColor={PILL_BG} color={theme.dim}>
      {` ${label} `}
    </Text>
  );
}

/** A status-bar key/value cell: dim label, bright value. */
export function Stat({ label, value, color = theme.fg }: { label: string; value: string; color?: string }) {
  return (
    <Text>
      <Text color={theme.dim}>{label} </Text>
      <Text color={color}>{value}</Text>
    </Text>
  );
}
