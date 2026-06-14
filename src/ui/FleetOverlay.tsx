import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Panel, FilledLine } from "./chrome.js";
import { projectFleet, swarmCompare, fmtElapsed } from "../core/fleet.js";
import type { Session } from "../core/session.js";
import { fmtUsd, fmtK } from "./format.js";

const HILITE_BG = "#1b273f";

/** Color-code a session status word. */
function statusColor(status: string): string {
  switch (status) {
    case "processing":
      return theme.warn;
    case "awaiting-permission":
    case "awaiting-input":
      return theme.accent;
    case "crashed":
      return theme.bad;
    default:
      return theme.good;
  }
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

/**
 * The fleet dashboard (Ctrl+F / `/fleet`): mission control for every Claude agent.
 * Bespoke (not Telescope — it needs the `x` side-action that interrupts WITHOUT
 * closing). Reads the headless projectFleet() projection, ticks a 1s clock so the
 * elapsed-turn column animates between sparse SDK messages, and maps row → original
 * tab index so activate/interrupt always hit the right tab past interleaved terminals.
 */
export function FleetOverlay({ onClose }: { onClose: () => void }) {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const [sel, setSel] = useState(0);
  const [compare, setCompare] = useState(false);
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const rows = projectFleet(manager.tabs, manager.activeIndex);
  const clamped = rows.length ? Math.min(sel, rows.length - 1) : 0;
  const swarm = manager.tabs.filter((t): t is Session => t.kind === "claude" && t.group === "swarm");

  // Keep `sel` in range when the fleet shrinks (a closed/interrupted agent) so the
  // arrow keys never feel dead from a stale-high selection index.
  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "f")) {
      onClose();
      return;
    }
    if (input === "c") {
      setCompare((c) => !c); // toggle the swarm compare view
      return;
    }
    if (input === "j" || key.downArrow) {
      setSel(Math.min(clamped + 1, rows.length - 1));
      return;
    }
    if (input === "k" || key.upArrow) {
      setSel(Math.max(0, clamped - 1));
      return;
    }
    if (key.return) {
      const r = rows[clamped];
      if (r) manager.activate(r.index);
      onClose();
      return;
    }
    if (input === "x") {
      const r = rows[clamped];
      const tab = r && manager.tabs[r.index];
      if (tab && tab.kind === "claude") void tab.interrupt(); // stays open; list updates via bump
      return;
    }
  }, { isActive: !manager.active?.pendingPermission });

  if (compare) {
    const entries = swarmCompare(swarm);
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Panel accent flexDirection="column">
          <Text bold color={theme.accent}>
            COMPARE · swarm ({entries.length})
          </Text>
          {entries.length === 0 ? (
            <Box marginTop={1}>
              <Text color={theme.dim}>no swarm agents — type </Text>
              <Text color={theme.accent}>/swarm &lt;task&gt;</Text>
              <Text color={theme.dim}> to launch one</Text>
            </Box>
          ) : (
            entries.map((e) => {
              const preview = e.lastText.replace(/\s+/g, " ").trim().slice(0, 220) || "(no answer yet)";
              return (
                <Box key={e.id} flexDirection="column" marginTop={1}>
                  <Text>
                    <Text bold color={theme.accent}>{e.title}</Text>
                    <Text color={theme.dim}>{`  ${e.status} · ${fmtUsd(e.costUsd)}`}</Text>
                  </Text>
                  <Text color={theme.fg} wrap="wrap">
                    {preview}
                  </Text>
                </Box>
              );
            })
          )}
          <Box marginTop={1}>
            <Text color={theme.dim}>c back to list · esc close</Text>
          </Box>
        </Panel>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Panel accent flexDirection="column">
        <Text bold color={theme.accent}>
          FLEET · {rows.length} agent{rows.length === 1 ? "" : "s"}
        </Text>
        {rows.length === 0 ? (
          <Box marginTop={1}>
            <Text color={theme.dim}>no agents yet — type </Text>
            <Text color={theme.accent}>/parallel &lt;task&gt;</Text>
            <Text color={theme.dim}> to launch a fleet</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {/* column header — truncate like the data rows so it can't wrap + misalign */}
            <Text color={theme.dim} wrap="truncate">
              {"  "}
              {pad("AGENT", 20)} {pad("STATUS", 12)} {pad("ACTIVITY", 30)} {"  ELAP"} {"   CTX"} {"   COST"}
            </Text>
            {rows.map((r, i) => {
              const selected = i === clamped;
              const body = (
                <>
                  <Text color={r.active ? theme.good : theme.dim}>{r.active ? "● " : "  "}</Text>
                  <Text bold={selected} color={selected ? theme.accent : theme.fg}>
                    {pad(r.title, 20)}{" "}
                  </Text>
                  <Text color={statusColor(r.status)}>{pad(r.status, 12)} </Text>
                  <Text color={theme.dim}>{pad(r.activity, 30)} </Text>
                  <Text color={theme.purple}>{fmtElapsed(r.elapsedMs).padStart(6)} </Text>
                  <Text color={theme.accent}>{fmtK(r.contextTokens).padStart(6)} </Text>
                  <Text color={theme.good}>{fmtUsd(r.costUsd).padStart(7)}</Text>
                  {r.queued > 0 && <Text color={theme.warn}> +{r.queued}q</Text>}
                </>
              );
              return selected ? (
                <FilledLine key={r.id} bg={HILITE_BG} trail={0}>
                  {body}
                </FilledLine>
              ) : (
                <Text key={r.id} wrap="truncate">
                  {body}
                </Text>
              );
            })}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.dim}>j/k move · enter focus · x interrupt · c compare · esc close</Text>
        </Box>
      </Panel>
    </Box>
  );
}
