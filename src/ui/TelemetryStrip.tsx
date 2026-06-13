import React from "react";
import { Box, Text, useStdout } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { bar, fmtK, CONTEXT_WINDOW } from "./format.js";

export function TelemetryStrip() {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const host = useApp((s) => s.hostStats);
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  const s = manager.active;
  if (!s) return null;
  const u = s.transcript.usage;
  const meta = s.transcript.meta;
  const ctxPct = Math.min(100, Math.round((u.contextTokens / CONTEXT_WINDOW) * 100));
  const mcp = meta.mcpServers.map((m) => m.name).join(",");

  // Build content segments in priority order (drop lower-priority ones when tight).
  // Priority: model+tokens+cost+context_bar > mem > branch > mcp
  const core = ` ${meta.model ?? "—"} · ${fmtK(u.inputTokens)}/${fmtK(u.outputTokens)} [${bar(ctxPct, 5)}] · $${u.costUsd.toFixed(2)}`;
  const memSeg = host ? ` · mem ${host.memUsedPct}%` : "";
  const branchSeg = host?.branch ? ` · ⎇ ${host.branch}` : "";
  const mcpSeg = mcp ? ` · ${mcp} ●` : "";

  // Greedily add segments until they exceed termWidth.
  let content = core;
  for (const seg of [memSeg, branchSeg, mcpSeg]) {
    if (content.length + seg.length <= termWidth) {
      content += seg;
    }
  }

  // Final safety: hard-truncate to termWidth so it can never wrap.
  const display = content.length > termWidth ? content.slice(0, termWidth - 1) + "…" : content;

  return (
    <Box width={termWidth} overflow="hidden">
      <Text color={theme.dim}>{display}</Text>
    </Box>
  );
}
