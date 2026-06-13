import React from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Panel, SectionHeader, Stat } from "./chrome.js";
import { bar, fmtK, fmtUptime, CONTEXT_WINDOW } from "./format.js";

const PANEL_WIDTH = 34;
const CONTENT_WIDTH = 30; // inside the round border + paddingX:1

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

export function SidePanel() {
  const { manager, config } = useAppCtx();
  useApp((s) => s.version);
  const host = useApp((s) => s.hostStats);
  const s = manager.active;
  if (!s) return null;

  const u = s.transcript.usage;
  const meta = s.transcript.meta;
  const blocks = s.transcript.blocks;

  // FIX 1: always show the EFFECTIVE model. meta.model is only populated from the
  // SDK init message (first turn). Before that, fall back to the user's primary
  // configured model so the panel is never blank.
  const model = meta.model ?? config.models[0] ?? "—";

  // Conversation turns visible to the user = user + assistant text blocks
  // (tool / thinking / info blocks are noise for a "how big is this chat" read).
  const msgCount = blocks.reduce(
    (n, b) => (b.kind === "user" || b.kind === "assistant" ? n + 1 : n),
    0
  );

  const tabIndex = manager.activeIndex + 1;
  const tabTotal = manager.tabs.length;

  const files = [...s.transcript.contextFiles].slice(-6);
  const ctxPct = Math.min(100, Math.round((u.contextTokens / CONTEXT_WINDOW) * 100));

  return (
    <Panel width={PANEL_WIDTH}>
      <SectionHeader label="SESSION" width={CONTENT_WIDTH} />
      <Stat label="MODEL" value={model} color={theme.fg} />
      <Stat label="TAB  " value={`${tabIndex}/${tabTotal}`} color={theme.fg} />
      <Stat label="MSGS " value={String(msgCount)} color={theme.fg} />
      <Stat
        label="TOKENS"
        value={`${fmtK(u.inputTokens)} in · ${fmtK(u.outputTokens)} out`}
        color={theme.fg}
      />
      <Text>
        <Text color={theme.accent}>{bar(ctxPct, 14)}</Text> <Text color={theme.dim}>{ctxPct}%</Text>
      </Text>
      <Stat label="COST " value={`$${u.costUsd.toFixed(2)} · ${u.turns} turns`} color={theme.fg} />
      <Text>
        <Text color={theme.dim}>{"PERMS "}</Text>
        <Text color={permColor(s.permissionMode)}>{s.permissionMode}</Text>
      </Text>
      {meta.mcpServers.map((m) => (
        <Text key={m.name}>
          <Text color={theme.dim}>{"MCP   "}</Text>
          <Text color={theme.fg}>{m.name}</Text>{" "}
          <Text color={m.status === "connected" ? theme.good : theme.bad}>●</Text>
        </Text>
      ))}

      <Box marginTop={1} flexDirection="column">
        <SectionHeader label="CONTEXT" width={CONTENT_WIDTH} />
        {files.length === 0 && <Text dimColor>(no files yet)</Text>}
        {files.map((f) => (
          <Text key={f}>
            <Text color={theme.dim}>{"› "}</Text>
            <Text color={theme.fg}>{f.length > 27 ? "…" + f.slice(-26) : f}</Text>
          </Text>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <SectionHeader label="HOST" width={CONTENT_WIDTH} />
        {host && (
          <>
            <Text color={theme.fg}>
              {host.hostname} <Text color={theme.dim}>· mem {host.memUsedPct}%</Text>
            </Text>
            {host.branch && <Text color={theme.purple}>⎇ {host.branch}</Text>}
            <Text dimColor>up {fmtUptime(host.uptimeSec)}</Text>
          </>
        )}
      </Box>
    </Panel>
  );
}
