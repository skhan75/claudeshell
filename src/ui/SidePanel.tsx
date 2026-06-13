import React from "react";
import { statSync } from "node:fs";
import path from "node:path";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Panel, SectionHeader, FilledLine, SIDEBAR_WIDTH } from "./chrome.js";
import { bar, fmtK, fmtUptime, fmtComma, fmtUsd, fmtBytes, fileIcon, CONTEXT_WINDOW } from "./format.js";
import type { SessionStatus } from "../core/types.js";

const PANEL_WIDTH = SIDEBAR_WIDTH; // 38
const CONTENT_WIDTH = PANEL_WIDTH - 4; // inside the round border + paddingX:1 → 34
const CARD_WIDTH = CONTENT_WIDTH - 4; // inside the nested card's own border + paddingX:1
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
      return theme.dim;
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
  const runningTools = blocks.reduce((n, b) => (b.kind === "tool" && b.status === "running" ? n + 1 : n), 0);

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
      {/* TARGET_NODE card ─ boxed host summary with a live status dot (no fill) */}
      <Box borderStyle="round" borderColor={theme.dim} flexDirection="column" paddingX={1} width={CONTENT_WIDTH}>
        <Text wrap="truncate">
          <Text bold color={theme.accent}>TARGET_NODE</Text>
          {gap("TARGET_NODE".length, 1, CARD_WIDTH)}
          <Text color={statusColor(s.status)}>●</Text>
        </Text>
        {host && (
          <>
            <Row label="HOST" value={host.hostname} color={theme.accent} width={CARD_WIDTH} />
            <Row label="OS" value={host.platform.split(" ")[0]} width={CARD_WIDTH} />
            <Row label="MEM" value={`${host.memUsedPct}%`} width={CARD_WIDTH} />
            <Row label="UP" value={fmtUptime(host.uptimeSec)} width={CARD_WIDTH} />
            {host.branch && <Row label="BRANCH" value={`⎇ ${host.branch}`} color={theme.purple} width={CARD_WIDTH} />}
          </>
        )}
      </Box>

      {/* AGENTS ─ every open session/terminal as an agent, with live status */}
      <Box marginTop={1} flexDirection="column">
        <SectionHeader label="AGENTS" width={CONTENT_WIDTH} right={`${tabTotal}`} />
        {manager.tabs.map((tab, i) => {
          const active = i === manager.activeIndex;
          const isTerm = tab.kind === "terminal";
          const word = isTerm ? (tab.status === "running" ? "run" : "exit") : tab.status;
          const dot = isTerm ? (tab.status === "running" ? theme.good : theme.dim) : statusColor(tab.status);
          const glyph = isTerm ? "▷" : "◆";
          const title = tab.title || (isTerm ? "terminal" : "session");
          const used = 1 /* marker */ + 2 /* dot+space */ + glyph.length + 1 /* space */;
          const budget = Math.max(3, CONTENT_WIDTH - used - word.length - 1);
          const shown = title.length > budget ? title.slice(0, budget - 1) + "…" : title;
          return (
            <Text key={i} wrap="truncate">
              <Text color={theme.accent}>{active ? "▎" : " "}</Text>
              <Text color={dot}>● </Text>
              <Text color={active ? theme.accent : theme.fg} bold={active}>{`${glyph} ${shown}`}</Text>
              {gap(used + shown.length, word.length, CONTENT_WIDTH)}
              <Text color={dot}>{word}</Text>
            </Text>
          );
        })}
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
        {(() => {
          const queued = s.queuedCount;
          const label = queued > 0 ? `${queued} queued` : runningTools > 0 ? `${runningTools} running` : s.status === "processing" ? "working…" : "idle";
          const color = queued > 0 || runningTools > 0 || s.status === "processing" ? theme.warn : theme.dim;
          return <Row label="ACTIVE" value={label} color={color} />;
        })()}
        <Row label="TOKENS" value={`${fmtK(u.inputTokens)} in · ${fmtK(u.outputTokens)} out`} />
        <Row label="CACHE" value={`${fmtK(u.cacheReadTokens)} read`} color={theme.accent} />
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
