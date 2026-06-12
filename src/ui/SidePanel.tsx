import React from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { bar, fmtK, fmtUptime, CONTEXT_WINDOW } from "./format.js";

function Header({ label }: { label: string }) {
  return <Text color={theme.dim}>{label}</Text>;
}

export function SidePanel() {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const host = useApp((s) => s.hostStats);
  const s = manager.active;
  if (!s) return null;
  const u = s.transcript.usage;
  const meta = s.transcript.meta;
  const files = [...s.transcript.contextFiles].slice(-6);
  const ctxPct = Math.round(((u.inputTokens + u.cacheReadTokens) / CONTEXT_WINDOW) * 100);

  return (
    <Box flexDirection="column" width={30} paddingLeft={1}>
      <Header label="CONTEXT" />
      {files.length === 0 && <Text dimColor>(no files yet)</Text>}
      {files.map((f) => (
        <Text key={f} color={theme.fg}>{f.length > 27 ? "…" + f.slice(-26) : f}</Text>
      ))}
      <Text> </Text>
      <Header label="SESSION" />
      <Text color={theme.fg}>MODEL  {meta.model ?? "—"}</Text>
      <Text color={theme.fg}>TOKENS {fmtK(u.inputTokens)} in · {fmtK(u.outputTokens)} out</Text>
      <Text color={theme.accent}>{bar(ctxPct, 14)} <Text color={theme.dim}>{ctxPct}%</Text></Text>
      <Text color={theme.fg}>COST   ${u.costUsd.toFixed(2)} · {u.turns} turns</Text>
      <Text color={theme.fg}>MODE   {s.permissionMode}</Text>
      {meta.mcpServers.map((m) => (
        <Text key={m.name} color={theme.fg}>
          MCP    {m.name} <Text color={m.status === "connected" ? theme.good : theme.bad}>●</Text>
        </Text>
      ))}
      <Text> </Text>
      <Header label="HOST" />
      {host && (
        <>
          <Text color={theme.fg}>{host.hostname} · mem {host.memUsedPct}%</Text>
          {host.branch && <Text color={theme.purple}>⎇ {host.branch}</Text>}
          <Text dimColor>up {fmtUptime(host.uptimeSec)}</Text>
        </>
      )}
    </Box>
  );
}
