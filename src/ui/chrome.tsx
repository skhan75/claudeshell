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
/** Width of the right-hand SidePanel column. Centralized so the chat width, the
 *  outer app frame, and the panel itself all agree on one number. */
export const SIDEBAR_WIDTH = 34;
/** Raised-key chip fill for keyboard-hint keycaps (a touch lighter than the app bg). */
export const KEYCAP_BG = "#262e3f";
/** Neutral-gray composer borders — a cool, calm "active"/"idle" pair (no blue tint),
 *  matching the reference prompt box. */
export const INPUT_BORDER_FOCUS = "#6b7280";
export const INPUT_BORDER = "#3a3f4a";
/** A faint raised fill for the composer interior (just above the app bg #0b0e14). */
export const INPUT_BG = "#141a26";

/** A boxed panel with a round border. Pass `accent` to highlight (focused) state, or
 *  `borderColor` to override the border tint. (Ink's Box has no background-color, so
 *  interior fills are done by callers via FilledLine padded to the content width.) */
export function Panel({
  children,
  accent = false,
  borderColor,
  flexGrow,
  width,
  height,
  flexDirection = "column",
}: {
  children: React.ReactNode;
  accent?: boolean;
  borderColor?: string;
  flexGrow?: number;
  width?: number;
  height?: number;
  flexDirection?: "row" | "column";
}) {
  return (
    <Box
      borderStyle={PANEL_BORDER}
      borderColor={borderColor ?? (accent ? theme.accent : theme.dim)}
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

/** A keyboard keycap chip — a glyph on a subtly-raised fill, like a physical key.
 *  Used in hint footers (e.g. `↑` `↓` `Tab`) to make affordances pop. */
export function Keycap({ label }: { label: string }) {
  return (
    <Text backgroundColor={KEYCAP_BG} color={theme.fg}>
      {` ${label} `}
    </Text>
  );
}

/**
 * One row of a background-filled region. Ink only paints a background on a <Text>
 * (its <Box> has no backgroundColor), so a filled "card" is built by laying content
 * over a common backgroundColor and padding the remainder with `trail` spaces to
 * reach the target width. Nested <Text> keep their own fg color but inherit this bg.
 */
export function FilledLine({
  bg,
  trail,
  children,
}: {
  bg: string;
  trail: number;
  children: React.ReactNode;
}) {
  return (
    <Text backgroundColor={bg} wrap="truncate">
      {children}
      {" ".repeat(Math.max(0, trail))}
    </Text>
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
