import React from "react";
import { statSync } from "node:fs";
import path from "node:path";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Panel, SectionHeader, FilledLine } from "./chrome.js";
import { bar, fmtK, fmtUptime, fmtComma, fmtUsd, fmtBytes, fileIcon, CONTEXT_WINDOW } from "./format.js";
import type { SessionStatus } from "../core/types.js";

const PANEL_WIDTH = 34;
const CONTENT_WIDTH = 30; // inside the round border + paddingX:1
const CARD_INNER = CONTENT_WIDTH - 2; // inside the nested card's own border (no paddingX; fills edge-to-edge)
const CARD_BG = "#121826"; // subtle raised fill for the boxed card
const HILITE_BG = "#1b273f"; // active-buffer selection fill

/** Color-code the permission mode so its risk level reads at a glance. */
function permColor(mode: string): string {
  switch (mode) {
    case "plan":
      return theme.accent;
    case "acceptEdits":
      return theme.warn;
    case "bypassPermissions":
      return theme.bad;
    default:
      return theme.dim; // "default" — least surprising, muted
  }
}

/** Color-code a session status dot/word. */
function statusColor(status: SessionStatus): string {
  switch (status) {
    case "processing":
      return theme.warn;
    case "awaiting-permission":
    case "awaiting-input":
      return theme.accent;
    case "crashed":
      return theme.bad;
    default:
      return theme.good; // idle = healthy/ready
  }
}

/** Best-effort file size; null when the path can't be stat'd (deleted/relative). */
function sizeOf(p: string): number | null {
  try {
    return statSync(p).size;
  } catch {
    return null;
  }
}

/** Display a context-file path compactly: relative to cwd when under it, else basename. */
function displayPath(file: string, cwd: string): string {
  if (file.startsWith(cwd + path.sep)) return file.slice(cwd.length + 1);
  if (path.isAbsolute(file)) return path.basename(file);
  return file;
}

/** Spaces to push a left/right pair to the edges of `width` (≥1, deterministic — no flexbox). */
function gap(leftLen: number, rightLen: number, width: number): string {
  return " ".repeat(Math.max(1, width - leftLen - rightLen));
}

/** A dim-label / colored-value row, right-aligned via explicit padding. */
function Row({ label, value, color = theme.fg, width = CONTENT_WIDTH }: { label: string; value: string; color?: string; width?: number }) {
  return (
    <Text wrap="truncate">
      <Text color={theme.dim}>{label}</Text>
      {gap(label.length, value.length, width)}
      <Text color={color}>{value}</Text>
    </Text>
  );
}

/** Like Row, but laid over a background fill (for the boxed card interior). */
function FilledRow({ label, value, color = theme.fg, bg, width = CARD_INNER }: { label: string; value: string; color?: string; bg: string; width?: number }) {
  return (
    <FilledLine bg={bg} trail={0}>
      <Text> </Text>
      <Text color={theme.dim}>{label}</Text>
      <Text>{" ".repeat(Math.max(1, width - 1 - label.length - value.length))}</Text>
      <Text color={color}>{value}</Text>
    </FilledLine>
  );
}

export function SidePanel({ height }: { height?: number } = {}) {
  const { manager, config } = useAppCtx();
  useApp((s) => s.version);
  const host = useApp((s) => s.hostStats);
  const s = manager.active;
  if (!s) return null;

  const u = s.transcript.usage;
  const meta = s.transcript.meta;
  const blocks = s.transcript.blocks;

  const model = meta.model ?? config.models[0] ?? "—";

  const msgCount = blocks.reduce(
    (n, b) => (b.kind === "user" || b.kind === "assistant" ? n + 1 : n),
    0
  );
  const toolCount = blocks.reduce((n, b) => (b.kind === "tool" ? n + 1 : n), 0);

  const tabIndex = manager.activeIndex + 1;
  const tabTotal = manager.tabs.length;

  // Loaded buffers = the context files Claude has touched; newest last (so the
  // last entry is the "active"/most-recently-loaded one, highlighted).
  const allFiles = [...s.transcript.contextFiles];
  const files = allFiles.slice(-7);
  const activePath = allFiles[allFiles.length - 1];

  const ctxPct = Math.min(100, Math.round((u.contextTokens / CONTEXT_WINDOW) * 100));
  const ctxColor = ctxPct >= 90 ? theme.bad : theme.accent;

  return (
    <Panel width={PANEL_WIDTH} height={height} flexDirection="column">
      {/* TARGET_NODE card ─ boxed host summary, filled, with a live status dot */}
      <Box borderStyle="round" borderColor={theme.dim} flexDirection="column" width={CONTENT_WIDTH}>
        <FilledLine bg={CARD_BG} trail={0}>
          <Text> </Text>
          <Text bold color={theme.accent}>TARGET_NODE</Text>
          <Text>{" ".repeat(Math.max(1, CARD_INNER - 1 - "TARGET_NODE".length - 1))}</Text>
          <Text color={statusColor(s.status)}>●</Text>
        </FilledLine>
        {host && (
          <>
            <FilledRow label="HOST" value={host.hostname} color={theme.accent} bg={CARD_BG} />
            <FilledRow label="OS" value={host.platform.split(" ")[0]} bg={CARD_BG} />
            <FilledRow label="MEM" value={`${host.memUsedPct}%`} bg={CARD_BG} />
            <FilledRow label="UP" value={fmtUptime(host.uptimeSec)} bg={CARD_BG} />
            {host.branch && <FilledRow label="BRANCH" value={`⎇ ${host.branch}`} color={theme.purple} bg={CARD_BG} />}
          </>
        )}
      </Box>

      {/* LOADED BUFFERS ─ context files with type icon + size; active is highlighted */}
      <Box marginTop={1} flexDirection="column">
        <SectionHeader label="LOADED BUFFERS" width={CONTENT_WIDTH} />
        {files.length === 0 && <Text dimColor>(no files yet)</Text>}
        {files.map((f) => {
          const active = f === activePath;
          const sz = sizeOf(f);
          const szLabel = sz === null ? "" : fmtBytes(sz);
          const icon = fileIcon(f);
          const iconField = icon.length === 1 ? icon + " " : icon; // pad to a 2-cell column
          const name = displayPath(f, s.cwd);
          const prefix = 1 + iconField.length + 1; // marker + icon + space
          const nameBudget = CONTENT_WIDTH - prefix - (szLabel ? szLabel.length + 1 : 0);
          const shown = name.length > nameBudget ? "…" + name.slice(-(nameBudget - 1)) : name;
          if (active) {
            const mid = Math.max(1, CONTENT_WIDTH - 1 - iconField.length - 1 - shown.length - szLabel.length);
            return (
              <FilledLine key={f} bg={HILITE_BG} trail={0}>
                <Text color={theme.accent}>▎</Text>
                <Text color={theme.accent}>{iconField}</Text>
                <Text> </Text>
                <Text bold color={theme.accent}>{shown}</Text>
                <Text>{" ".repeat(mid)}</Text>
                <Text color={theme.dim}>{szLabel}</Text>
              </FilledLine>
            );
          }
          return (
            <Text key={f} wrap="truncate">
              <Text color={theme.accent}> </Text>
              <Text color={theme.purple}>{iconField}</Text>
              <Text> </Text>
              <Text color={theme.fg}>{shown}</Text>
              {szLabel && (
                <>
                  {gap(prefix + shown.length, szLabel.length, CONTENT_WIDTH)}
                  <Text color={theme.dim}>{szLabel}</Text>
                </>
              )}
            </Text>
          );
        })}
      </Box>

      {/* SESSION ─ model / status / tab / perms / mcp */}
      <Box marginTop={1} flexDirection="column">
        <SectionHeader label="SESSION" width={CONTENT_WIDTH} />
        <Row label="MODEL" value={model} color={theme.fg} />
        <Row label="STATUS" value={s.status} color={statusColor(s.status)} />
        <Row label="TAB" value={`${tabIndex}/${tabTotal}`} />
        <Row label="PERMS" value={s.permissionMode} color={permColor(s.permissionMode)} />
        {meta.mcpServers.map((m) => (
          <Text key={m.name} wrap="truncate">
            <Text color={theme.dim}>MCP</Text>
            {gap(3, m.name.length + 2, CONTENT_WIDTH)}
            <Text color={theme.fg}>{m.name}</Text>{" "}
            <Text color={m.status === "connected" ? theme.good : theme.bad}>●</Text>
          </Text>
        ))}
      </Box>

      {/* Spacer pushes the usage/cost/token block to the bottom of the panel. */}
      <Box flexGrow={1} />

      {/* USAGE ─ session metrics, cost (total + current inference), token meter */}
      <Box flexDirection="column">
        <SectionHeader label="USAGE" width={CONTENT_WIDTH} />
        <Row label="MSGS" value={`${msgCount} · ${u.turns} turns · ${toolCount} tools`} />
        <Row label="TOKENS" value={`${fmtK(u.inputTokens)} in · ${fmtK(u.outputTokens)} out`} />
        <Row label="COST" value={`${fmtUsd(u.costUsd)} total`} color={theme.good} />
        <Row label="INFER" value={`${fmtUsd(u.lastTurnCostUsd)} last turn`} color={theme.warn} />

        <Box marginTop={1} flexDirection="column">
          <Text wrap="truncate">
            <Text bold color={theme.accent}>TOKEN_USAGE</Text>
            {gap("TOKEN_USAGE".length, `${ctxPct}%`.length, CONTENT_WIDTH)}
            <Text color={ctxPct >= 90 ? theme.bad : theme.fg}>{ctxPct}%</Text>
          </Text>
          <Text color={ctxColor}>{bar(ctxPct, CONTENT_WIDTH)}</Text>
          <Text wrap="truncate">
            <Text color={theme.fg}>{fmtComma(u.contextTokens)}</Text>
            {gap(fmtComma(u.contextTokens).length, `${fmtComma(CONTEXT_WINDOW)} MAX`.length, CONTENT_WIDTH)}
            <Text color={theme.dim}>{fmtComma(CONTEXT_WINDOW)} MAX</Text>
          </Text>
        </Box>
      </Box>
    </Panel>
  );
}
