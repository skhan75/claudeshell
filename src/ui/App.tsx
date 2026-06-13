import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { matchKey } from "./keys.js";
import { TabBar } from "./TabBar.js";
import { ChatPane } from "./ChatPane.js";
import { SidePanel } from "./SidePanel.js";
import { TelemetryStrip } from "./TelemetryStrip.js";
import { InputBar } from "./InputBar.js";
import { PillBar } from "./PillBar.js";
import { CommandPalette } from "./CommandPalette.js";
import { ActivityIndicator } from "./ActivityIndicator.js";
import { PermissionDialog, QuestionDialog } from "./dialogs.js";
import { Rule, Stat } from "./chrome.js";
import { theme } from "./theme.js";
import type { SessionStatus } from "../core/types.js";

/** Color-code a session status. Reads theme.* at call time so applyTheme() sticks. */
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
      return theme.dim;
  }
}

/** Last two path segments of a cwd, e.g. /a/b/c/d → c/d. */
function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || "/";
}

function clockNow(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export function App() {
  const { manager, config, store } = useAppCtx();
  useApp((s) => s.version);
  const layout = useApp((s) => s.layout);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const hostStats = useApp((s) => s.hostStats);
  const session = manager.active;
  const pending = session?.pendingPermission ?? null;

  useEffect(() => manager.subscribe(() => store.getState().bump()), [manager, store]);

  const [clock, setClock] = useState(clockNow);
  useEffect(() => {
    const id = setInterval(() => setClock(clockNow()), 1000);
    return () => clearInterval(id);
  }, []);

  const { stdout } = useStdout();
  useEffect(() => {
    const onResize = () => store.getState().bump();
    stdout?.on("resize", onResize);
    return () => {
      stdout?.off("resize", onResize);
    };
  }, [stdout, store]);

  const termWidth = stdout?.columns ?? 80;
  const tooSmall = (stdout?.columns ?? 80) < 60 || (stdout?.rows ?? 24) < 14;

  useInput(
    (input, key) => {
      if (session?.status === "crashed" && input === "r") {
        session.resume();
        return;
      }
      if (key.escape && session?.status === "processing") {
        void session.interrupt();
        return;
      }
      const st = store.getState();
      if (matchKey(config.keys.palette, input, key)) return st.setPaletteOpen(true);
      if (matchKey(config.keys.layoutToggle, input, key)) return st.toggleLayout();
      if (matchKey(config.keys.newSession, input, key)) {
        manager.create();
        return;
      }
      if (matchKey(config.keys.closeSession, input, key)) {
        if (session) manager.close(session.id);
        return;
      }
      if (matchKey(config.keys.focusToggle, input, key)) {
        // FIX 1: esc only transitions input->scroll to avoid double-fire with ChatPane.
        // When focus is already scroll, ChatPane owns esc (clear search).
        if (st.focus === "input") {
          st.setFocus("scroll");
        }
        return;
      }
      // FIX 1: 'i' returns from scroll back to input, avoiding esc collision with ChatPane.
      if (input === "i" && st.focus === "scroll") {
        st.setFocus("input");
        return;
      }
      if ((key.meta ?? false) && /^[1-9]$/.test(input)) manager.activate(Number(input) - 1);
    },
    { isActive: !pending && !paletteOpen && !tooSmall }
  );

  if (tooSmall) {
    return <Text color="yellow">terminal too small for claudeshell — resize to at least 60×14</Text>;
  }

  const status: SessionStatus = session?.status ?? "idle";
  const model = session?.transcript.meta.model ?? "—";
  const mode = session?.permissionMode ?? "default";
  const branch = hostStats?.branch ?? null;
  const cwdLabel = session ? shortCwd(session.cwd) : "—";

  // Pin the layout to the terminal height: header (status row + rule, +1 for zen
  // telemetry) and a 1-row footer are reserved, and the main row is capped with
  // overflow:hidden so the bordered sidebar can never push the footer off-screen.
  // The chat area gets an explicit height (the rest goes to the input/pills block).
  const termRows = stdout?.rows ?? 24;
  const headerRows = 2 + (layout === "zen" ? 1 : 0);
  const FOOTER_ROWS = 1;
  const INPUT_AREA_ROWS = 7; // bordered input box + pills + slack for activity/suggestions
  const mainHeight = Math.max(4, termRows - headerRows - FOOTER_ROWS);
  const chatHeight = Math.max(3, mainHeight - INPUT_AREA_ROWS);

  return (
    <Box flexDirection="column">
      {/* Header: brand + tabs on the left, holistic session status on the right */}
      <Box>
        <Box flexGrow={1}>
          <TabBar />
        </Box>
        <Box>
          <Stat label="MODEL" value={model} color={theme.accent} />
          <Text color={theme.dim}> · </Text>
          <Stat label="STATUS" value={status} color={statusColor(status)} />
          <Text color={theme.dim}> · </Text>
          <Text color={theme.fg}>{clock}</Text>
        </Box>
      </Box>
      <Rule width={termWidth} />
      {layout === "zen" && <TelemetryStrip />}
      <Box height={mainHeight} overflow="hidden">
        <Box flexDirection="column" flexGrow={1}>
          <ChatPane height={chatHeight} />
          {pending ? (
            pending.toolName === "AskUserQuestion" ? (
              <QuestionDialog key={pending.id} request={pending} />
            ) : (
              <PermissionDialog key={pending.id} request={pending} />
            )
          ) : paletteOpen ? (
            <CommandPalette />
          ) : (
            <>
              {session?.status === "processing" && <ActivityIndicator />}
              <InputBar />
              <PillBar />
            </>
          )}
        </Box>
        {layout === "sidebar" && <SidePanel />}
      </Box>
      {/* Footer: single dim status line, segments separated by ` · `, truncated to width */}
      <Box width={termWidth} overflow="hidden">
        <Text color={theme.dim} wrap="truncate">
          {"⌗ "}
          {cwdLabel}
          {branch ? (
            <Text>
              {" · "}
              <Text color={theme.purple}>{`⎇ ${branch}`}</Text>
            </Text>
          ) : (
            ""
          )}
          {` · MODE ${mode} · `}
          <Text color={theme.good}>System OK</Text>
        </Text>
      </Box>
    </Box>
  );
}
