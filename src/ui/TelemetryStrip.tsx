import React from "react";
import { Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { bar, fmtK, CONTEXT_WINDOW } from "./format.js";

export function TelemetryStrip() {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const host = useApp((s) => s.hostStats);
  const s = manager.active;
  if (!s) return null;
  const u = s.transcript.usage;
  const meta = s.transcript.meta;
  const ctxPct = Math.round(((u.inputTokens + u.cacheReadTokens) / CONTEXT_WINDOW) * 100);
  const mcp = meta.mcpServers.map((m) => m.name).join(",");

  return (
    <Text color={theme.dim}>
      {" "}{meta.model ?? "—"} · {fmtK(u.inputTokens)}/{fmtK(u.outputTokens)}{" "}
      <Text color={theme.accent}>{bar(ctxPct, 5)}</Text> · ${u.costUsd.toFixed(2)}
      {mcp ? ` · ${mcp} ●` : ""}{host?.branch ? ` · ⎇ ${host.branch}` : ""}
      {host ? ` · mem ${host.memUsedPct}%` : ""}
    </Text>
  );
}
