import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout, useApp as useInkApp } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { matchKey } from "./keys.js";
import { TabBar } from "./TabBar.js";
import { ChatPane } from "./ChatPane.js";
import { SidePanel } from "./SidePanel.js";
import { SidebarPanel } from "./SidebarPanel.js";
import { TelemetryStrip } from "./TelemetryStrip.js";
import { InputBar } from "./InputBar.js";
import { CommandPalette } from "./CommandPalette.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { SessionsOverlay } from "./SessionsOverlay.js";
import { BuffersOverlay } from "./BuffersOverlay.js";
import { TerminalPane } from "./TerminalPane.js";
import { ActivityIndicator } from "./ActivityIndicator.js";
import { PermissionDialog, QuestionDialog } from "./dialogs.js";
import { Rule, Stat, PILL_BG, SIDEBAR_WIDTH, LEFT_PANEL_WIDTH } from "./chrome.js";
import { theme } from "./theme.js";
import type { SessionStatus } from "../core/types.js";
import { createRequire } from "node:module";

// App version for the footer badge — resolves to the package root in dev and dist.
const VERSION: string = (() => {
  try {
    return (createRequire(import.meta.url)("../../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();

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
  const { exit: inkExit } = useInkApp();
  useApp((s) => s.version);
  const layout = useApp((s) => s.layout);
  const leftPanel = useApp((s) => s.leftPanel);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const overlay = useApp((s) => s.overlay);
  const hostStats = useApp((s) => s.hostStats);
  const session = manager.active;
  const pending = session?.pendingPermission ?? null;
  const activeTab = manager.activeTab;
  const terminalTab = activeTab?.kind === "terminal" ? activeTab : null;
  const isTerm = terminalTab !== null;

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
      // exitOnCtrlC is disabled (cli.tsx) so Ctrl+C reaches us; preserve
      // Ctrl+C-quits from Claude tabs (terminal tabs route their own input).
      if (key.ctrl && input === "c") {
        inkExit();
        return;
      }
      // Alt+\ spawns a terminal tab.
      if ((key.meta ?? false) && input === "\\") {
        manager.createTerminal();
        return;
      }
      // Ctrl+→ / Ctrl+← cycle to the next / previous tab (fast keyboard nav that
      // doesn't need the Alt modifier, which many terminals strip).
      // Ctrl+E cycles the left IDE explorer: file tree → conversation outline →
      // hidden → file tree (VS Code's "explorer" key; ^B/^\ are already taken).
      if (key.ctrl && input === "e") {
        store.getState().cycleLeftPanel();
        return;
      }
      if (key.ctrl && key.rightArrow) {
        manager.cycleActive(1);
        return;
      }
      if (key.ctrl && key.leftArrow) {
        manager.cycleActive(-1);
        return;
      }
      // Discoverability/onboarding overlays + explicit quit (Ctrl combos take
      // priority over the configurable matchKey checks below).
      if (key.ctrl && input === "g") {
        store.getState().setOverlay("help");
        return;
      }
      if (key.ctrl && input === "r") {
        store.getState().setOverlay("sessions");
        return;
      }
      // Ctrl+B (0x02) is free globally → the blazing-fast buffer/tab switcher.
      if (key.ctrl && input === "b") {
        store.getState().setOverlay("buffers");
        return;
      }
      if (key.ctrl && input === "q") {
        inkExit();
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
    { isActive: !pending && !paletteOpen && !overlay && !tooSmall && !isTerm }
  );

  if (tooSmall) {
    return <Text color="yellow">terminal too small for claudeshell — resize to at least 60×14</Text>;
  }

  const status: SessionStatus = session?.status ?? "idle";
  const model = session?.transcript.meta.model ?? config.models[0] ?? "—";
  const mode = session?.permissionMode ?? "default";
  const branch = hostStats?.branch ?? null;
  // Header is tab-aware: a terminal tab labels its model "shell" and surfaces the
  // PTY's running/exited status (good while running, dim once exited).
  const modelLabel = terminalTab ? "shell" : model;
  const statusLabel = terminalTab ? terminalTab.status : status;
  const statusFg = terminalTab ? (terminalTab.status === "running" ? theme.good : theme.dim) : statusColor(status);
  const cwdLabel = activeTab ? shortCwd(activeTab.cwd) : "—";

  // No outer frame: the shell fills the terminal edge-to-edge so it uses all the
  // available width/height. Header (status row + rule, +1 for zen telemetry) and a
  // 1-row footer are reserved; the explicit heights sum to termRows so the status
  // bar pins to the very bottom row, and the main row is capped with overflow:hidden.
  const termRows = stdout?.rows ?? 24;
  const innerWidth = termWidth;
  const headerRows = 2 + (layout === "zen" ? 1 : 0);
  const FOOTER_ROWS = 1;
  const INPUT_AREA_ROWS = 7; // bordered input box + pills + slack for activity/suggestions
  const mainHeight = Math.max(4, termRows - headerRows - FOOTER_ROWS);
  const chatHeight = Math.max(3, mainHeight - INPUT_AREA_ROWS);
  // IDE columns: left explorer + chat (editor) + right inspector. The left rail
  // only shows in the sidebar layout, when not hidden, on a Claude tab, and when
  // the terminal is wide enough to keep the chat usable.
  const rightCols = layout === "sidebar" ? SIDEBAR_WIDTH : 0;
  const leftVisible = layout === "sidebar" && leftPanel !== "hidden" && !isTerm && innerWidth >= 100;
  const leftCols = leftVisible ? LEFT_PANEL_WIDTH : 0;
  const chatWidth = Math.max(20, layout === "sidebar" ? innerWidth - leftCols - rightCols : innerWidth - 2);
  const leftCwd = activeTab?.cwd ?? ".";
  const ctxFiles = session ? [...session.transcript.contextFiles] : [];
  const lastCtx = ctxFiles[ctxFiles.length - 1];
  const activeFile = lastCtx
    ? lastCtx.startsWith(leftCwd + "/")
      ? lastCtx.slice(leftCwd.length + 1)
      : lastCtx
    : undefined;

  return (
    <Box flexDirection="column" width={termWidth} height={termRows} overflow="hidden">
      {/* Header: brand + tabs on the left, holistic session status on the right */}
      <Box>
        <Box flexGrow={1}>
          <TabBar />
        </Box>
        <Box>
          <Stat label="MODEL" value={modelLabel} color={theme.accent} />
          <Text color={theme.dim}> · </Text>
          <Stat label="STATUS" value={statusLabel} color={statusFg} />
          <Text color={theme.dim}> · </Text>
          <Text color={theme.fg}>{clock}</Text>
        </Box>
      </Box>
      <Rule width={innerWidth} />
      {layout === "zen" && <TelemetryStrip />}
      <Box height={mainHeight} overflow="hidden">
        {/* Left IDE rail (explorer / outline) — first column, hidden during
            overlays/palette/terminal so those can use the full width. */}
        {leftVisible && session && !overlay && !paletteOpen && (
          <SidebarPanel width={LEFT_PANEL_WIDTH} height={mainHeight} cwd={leftCwd} activeFile={activeFile} />
        )}
        {/* Overlays/palette are Claude-context but take precedence over everything
            (including a terminal tab) so the leader's g/k/r open them over a term.
            Otherwise: a terminal tab renders the full-width TerminalPane; a Claude
            tab renders the chat column with dialogs/palette/input below the chat. */}
        {overlay === "help" ? (
          <Box flexDirection="column" flexGrow={1}>
            <HelpOverlay onClose={() => store.getState().setOverlay(null)} />
          </Box>
        ) : overlay === "sessions" ? (
          <Box flexDirection="column" flexGrow={1}>
            <SessionsOverlay onClose={() => store.getState().setOverlay(null)} />
          </Box>
        ) : overlay === "buffers" ? (
          <Box flexDirection="column" flexGrow={1}>
            <BuffersOverlay onClose={() => store.getState().setOverlay(null)} />
          </Box>
        ) : paletteOpen ? (
          <Box flexDirection="column" flexGrow={1}>
            <CommandPalette />
          </Box>
        ) : isTerm ? (
          <TerminalPane height={mainHeight} onQuit={inkExit} />
        ) : (
          <Box flexDirection="column" flexGrow={1}>
            <ChatPane height={chatHeight} width={chatWidth} />
            {pending ? (
              pending.toolName === "AskUserQuestion" ? (
                <QuestionDialog key={pending.id} request={pending} />
              ) : (
                <PermissionDialog key={pending.id} request={pending} />
              )
            ) : (
              <>
                {session?.status === "processing" && <ActivityIndicator />}
                <InputBar width={chatWidth} />
              </>
            )}
          </Box>
        )}
        {layout === "sidebar" && !overlay && !paletteOpen && !isTerm && <SidePanel height={mainHeight} />}
      </Box>
      {/* Footer: tab chip + cwd pill + key hints on the left, a right-aligned
          health badge with version. Padding is computed (not flexbox) so the
          badge pins to the right edge deterministically across widths. */}
      {(() => {
        const idxChip = `[${manager.activeIndex + 1}/${manager.tabs.length}]`;
        const cwdPad = ` ${cwdLabel} `;
        const branchStr = branch ? ` ⎇ ${branch}` : "";
        const hints = isTerm
          ? ` · Ctrl+\\ leader · ^K cmds · ^G help · ^Q quit`
          : ` · MODE ${mode} · ^K cmds · ^G help · ^Q quit`;
        const badge = `✓ System OK v${VERSION}`;
        const fixedLeft = idxChip.length + cwdPad.length + branchStr.length;
        // Reserve room for the badge so the health status never truncates; the hint
        // list (lower priority) absorbs the squeeze on narrow terminals instead.
        const room = Math.max(0, innerWidth - fixedLeft - badge.length - 1);
        const hintsShown = hints.length > room ? hints.slice(0, room) : hints;
        const padLen = Math.max(1, innerWidth - fixedLeft - hintsShown.length - badge.length);
        return (
          <Box width={innerWidth} overflow="hidden">
            <Text wrap="truncate">
              <Text color={theme.accent}>{idxChip}</Text>
              <Text backgroundColor={PILL_BG} color={theme.fg}>{cwdPad}</Text>
              {branch && <Text color={theme.purple}>{branchStr}</Text>}
              <Text color={theme.dim}>{hintsShown}</Text>
              {" ".repeat(padLen)}
              <Text color={theme.good}>{badge}</Text>
            </Text>
          </Box>
        );
      })()}
    </Box>
  );
}
