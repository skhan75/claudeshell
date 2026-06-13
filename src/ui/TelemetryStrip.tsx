import React from "react";
import { Box, Text, useStdout } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { bar, fmtK, CONTEXT_WINDOW } from "./format.js";

const SEP = " · ";

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

  // Plain-text twins of every segment, used purely for width measurement so the
  // strip can never wrap. Priority: model+tokens+cost+context_bar > mem > branch > mcp.
  const coreText = ` ${meta.model ?? "—"}${SEP}${fmtK(u.inputTokens)}/${fmtK(u.outputTokens)} [${bar(ctxPct, 5)}]${SEP}$${u.costUsd.toFixed(2)}`;
  const memText = host ? `${SEP}mem ${host.memUsedPct}%` : "";
  const branchText = host?.branch ? `${SEP}⎇ ${host.branch}` : "";
  const mcpText = mcp ? `${SEP}${mcp} ●` : "";

  // Greedily decide which optional segments fit on one line.
  let measured = coreText;
  const fits: Record<"mem" | "branch" | "mcp", boolean> = { mem: false, branch: false, mcp: false };
  for (const [key, seg] of [
    ["mem", memText],
    ["branch", branchText],
    ["mcp", mcpText],
  ] as Array<["mem" | "branch" | "mcp", string]>) {
    if (seg && measured.length + seg.length <= termWidth) {
      measured += seg;
      fits[key] = true;
    }
  }

  // If even the core overflows, hard-truncate a plain string — guarantees no wrap.
  if (measured.length > termWidth) {
    const flat = measured.slice(0, termWidth - 1) + "…";
    return (
      <Box width={termWidth} overflow="hidden">
        <Text color={theme.dim}>{flat}</Text>
      </Box>
    );
  }

  const sep = <Text color={theme.dim}>{SEP}</Text>;

  return (
    <Box width={termWidth} overflow="hidden">
      <Text>
        <Text color={theme.dim}>{" "}</Text>
        <Text color={theme.fg}>{meta.model ?? "—"}</Text>
        {sep}
        <Text color={theme.fg}>
          {fmtK(u.inputTokens)}/{fmtK(u.outputTokens)} <Text color={theme.accent}>[{bar(ctxPct, 5)}]</Text>
        </Text>
        {sep}
        <Text color={theme.fg}>${u.costUsd.toFixed(2)}</Text>
        {fits.mem && host && (
          <>
            {sep}
            <Text color={theme.dim}>mem {host.memUsedPct}%</Text>
          </>
        )}
        {fits.branch && host?.branch && (
          <>
            {sep}
            <Text color={theme.purple}>⎇ {host.branch}</Text>
          </>
        )}
        {fits.mcp && mcp && (
          <>
            {sep}
            <Text color={theme.fg}>{mcp}</Text> <Text color={theme.good}>●</Text>
          </>
        )}
      </Text>
    </Box>
  );
}
