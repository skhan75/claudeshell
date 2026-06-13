import React from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Panel, SectionHeader, Stat } from "./chrome.js";
import { bar, fmtK, fmtUptime, CONTEXT_WINDOW } from "./format.js";

const PANEL_WIDTH = 34;
const CONTENT_WIDTH = 30; // inside the round border + paddingX:1

export function SidePanel() {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const host = useApp((s) => s.hostStats);
  const s = manager.active;
  if (!s) return null;
  const u = s.transcript.usage;
  const meta = s.transcript.meta;
  const files = [...s.transcript.contextFiles].slice(-6);
  const ctxPct = Math.min(100, Math.round((u.contextTokens / CONTEXT_WINDOW) * 100));

  return (
    <Panel width={PANEL_WIDTH}>
      <SectionHeader label="CONTEXT" width={CONTENT_WIDTH} />
      {files.length === 0 && <Text dimColor>(no files yet)</Text>}
      {files.map((f) => (
        <Text key={f}>
          <Text color={theme.dim}>{"› "}</Text>
          <Text color={theme.fg}>{f.length > 27 ? "…" + f.slice(-26) : f}</Text>
        </Text>
      ))}

      <Box marginTop={1} flexDirection="column">
        <SectionHeader label="SESSION" width={CONTENT_WIDTH} />
        <Stat label="MODEL " value={meta.model ?? "—"} color={theme.fg} />
        <Stat label="TOKENS" value={`${fmtK(u.inputTokens)} in · ${fmtK(u.outputTokens)} out`} color={theme.fg} />
        <Text>
          <Text color={theme.accent}>{bar(ctxPct, 14)}</Text> <Text color={theme.dim}>{ctxPct}%</Text>
        </Text>
        <Stat label="COST  " value={`$${u.costUsd.toFixed(2)} · ${u.turns} turns`} color={theme.fg} />
        <Stat label="MODE  " value={s.permissionMode} color={theme.fg} />
        {meta.mcpServers.map((m) => (
          <Text key={m.name}>
            <Text color={theme.dim}>{"MCP   "}</Text>{" "}
            <Text color={theme.fg}>{m.name}</Text>{" "}
            <Text color={m.status === "connected" ? theme.good : theme.bad}>●</Text>
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
