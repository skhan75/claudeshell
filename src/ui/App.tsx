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
import { ModelPicker } from "./ModelPicker.js";
import { CompactOverlay } from "./CompactOverlay.js";
import { FleetOverlay } from "./FleetOverlay.js";
import { BudgetOverlay } from "./BudgetOverlay.js";
import { ReviewOverlay } from "./ReviewOverlay.js";
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
  const focus = useApp((s) => s.focus);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const overlay = useApp((s) => s.overlay);
  const mouseScroll = useApp((s) => s.mouseScroll);
  const hostStats = useApp((s) => s.hostStats);
  const session = manager.active;
  const pending = session?.pendingPermission ?? null;
  const activeTab = manager.activeTab;
  const terminalTab = activeTab?.kind === "terminal" ? activeTab : null;
  const isTerm = terminalTab !== null;

  useEffect(() => manager.subscribe(() => store.getState().bump()), [manager, store]);

  // Ctrl+Space leader: a terminal can't deliver Ctrl+Space+arrow as one chord, so we
  // treat Ctrl+Space (NUL) as a one-shot prefix — the next ←/→ cycles tabs. Lives in the
  // store so InputBar/ChatPane can stand down while it's armed (no cursor-move/scroll clash).
  const tabLeader = useApp((s) => s.tabLeader);
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

  // An overlay (fleet/budget/review/…) renders ABOVE the chat's permission dialog in the
  // if/else chain. If the active session raises a permission while an overlay is open, the
  // dialog would be hidden and the overlay would eat the answer keys — so close the overlay.
  useEffect(() => {
    if (pending && overlay) store.getState().setOverlay(null);
  }, [pending, overlay, store]);

  // Mouse-scroll toggle: capture the mouse (SGR 1006) only while enabled so trackpad/wheel
  // scroll the transcript. Disabled on toggle-off and unmount so native text-selection/copy
  // returns. Written to the real process.stdout (a mode-set, out of band from Ink's frame)
  // and guarded on isTTY so it no-ops in tests. (cli.tsx also disables on hard exit.)
  useEffect(() => {
    if (!process.stdout.isTTY) return;
    process.stdout.write(mouseScroll ? "\x1b[?1000h\x1b[?1006h" : "\x1b[?1000l\x1b[?1006l");
    return () => {
      if (process.stdout.isTTY) process.stdout.write("\x1b[?1000l\x1b[?1006l");
    };
  }, [mouseScroll]);

  const termWidth = stdout?.columns ?? 80;
  const tooSmall = (stdout?.columns ?? 80) < 60 || (stdout?.rows ?? 24) < 14;

  useInput(
    (input, key) => {
      // Ctrl+Space tab-cycle leader: armed → the next ←/→ cycles tabs (one-shot); any
      // other key cancels it and falls through to normal handling.
      if (tabLeader) {
        if (key.leftArrow) { store.getState().setTabLeader(false); manager.cycleActive(-1); return; }
        if (key.rightArrow) { store.getState().setTabLeader(false); manager.cycleActive(1); return; }
        store.getState().setTabLeader(false);
      }
      if (key.ctrl && (input === "`" || input === " ")) { // Ctrl+Space = NUL, Ink reports it as Ctrl+backtick
        store.getState().setTabLeader(true);
        return;
      }
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
      // Ctrl+E drives the left explorer — BUT in the composer (input focus) Ctrl+E is
      // line-end (readline), so the explorer toggle yields there; reach it from scroll
      // focus (Esc then Ctrl+E) or the command palette ("toggle explorer").
      if (key.ctrl && input === "e" && focus !== "input") {
        const st = store.getState();
        if (st.leftPanel === "hidden") {
          st.setLeftPanel("files");
          st.setFocus("explorer");
        } else if (st.focus !== "explorer") {
          st.setFocus("explorer");
        } else {
          st.setLeftPanel("hidden");
          st.setFocus("input");
        }
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
      // Ctrl+F → the fleet dashboard (mission control for all agents).
      if (key.ctrl && input === "f") {
        store.getState().setOverlay("fleet");
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
  // The inspector is a full-height right column (top→bottom); the header/rule/chat/
  // footer all live in the left column, so the header ends where the inspector starts.
  const rightVisible = layout === "sidebar" && !isTerm && !overlay && !paletteOpen;
  const rightCols = rightVisible ? SIDEBAR_WIDTH : 0;
  const leftWidth = Math.max(20, innerWidth - rightCols);
  const leftVisible =
    layout === "sidebar" && leftPanel !== "hidden" && !isTerm && (innerWidth >= 100 || focus === "explorer");
  const leftCols = leftVisible ? LEFT_PANEL_WIDTH : 0;
  const chatWidth = Math.max(20, layout === "sidebar" ? leftWidth - leftCols : innerWidth - 2);
  // The tab strip shares the header row with the compact status block; give TabBar
  // only the space left over so it doesn't overflow the (now narrower) left column.
  const statusWidth =
    (isTerm ? `MODEL ${modelLabel} · `.length : 0) + `● STATUS ${statusLabel} · ${clock}`.length;
  const tabBarWidth = Math.max(10, leftWidth - statusWidth - 1);
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
      {/* Top region: a left column (header + chat) beside the full-height inspector;
          the header/rule end where the inspector begins. */}
      <Box flexDirection="row" height={Math.max(1, termRows - FOOTER_ROWS)} overflow="hidden">
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {/* Header: brand + tabs on the left, holistic session status on the right */}
        <Box>
          <Box width={tabBarWidth} overflow="hidden">
            <TabBar width={tabBarWidth} />
          </Box>
          <Box flexGrow={1} />
          <Box>
            {/* MODEL only on a terminal tab (no side panel there to carry it); Claude
                tabs show the model in the inspector + composer, keeping the header
                compact so it fits beside the full-height panel. */}
            {isTerm && (
              <>
                <Stat label="MODEL" value={modelLabel} color={theme.accent} />
                <Text color={theme.dim}> · </Text>
              </>
            )}
            <Text color={statusFg}>● </Text>
            <Stat label="STATUS" value={statusLabel} color={statusFg} />
            <Text color={theme.dim}> · </Text>
            <Text color={theme.fg}>{clock}</Text>
          </Box>
        </Box>
        <Rule width={leftWidth} />
        {layout === "zen" && <TelemetryStrip />}
        <Box height={mainHeight} overflow="hidden">
          {/* Left IDE rail (explorer) — hidden during overlays/palette/terminal. */}
          {leftVisible && session && !overlay && !paletteOpen && (
            <SidebarPanel
              width={LEFT_PANEL_WIDTH}
              height={mainHeight}
              cwd={leftCwd}
              activeFile={activeFile}
              focused={focus === "explorer"}
              onExit={() => store.getState().setFocus("input")}
              onOpenFile={(rel) => {
                // Editor satellite: open the picked file in $EDITOR, then drop the
                // explorer focus so returning from the editor lands back on input.
                manager.openInEditor(rel);
                store.getState().setFocus("input");
              }}
            />
          )}
          {/* Overlays/palette take precedence over a terminal tab; a Claude tab
              renders the chat column with dialogs/palette/input below the chat. */}
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
          ) : overlay === "models" ? (
            <Box flexDirection="column" flexGrow={1}>
              <ModelPicker onClose={() => store.getState().setOverlay(null)} />
            </Box>
          ) : overlay === "compact" ? (
            <Box flexDirection="column" flexGrow={1}>
              <CompactOverlay onClose={() => store.getState().setOverlay(null)} />
            </Box>
          ) : overlay === "fleet" ? (
            <Box flexDirection="column" flexGrow={1}>
              <FleetOverlay onClose={() => store.getState().setOverlay(null)} />
            </Box>
          ) : overlay === "budget" ? (
            <Box flexDirection="column" flexGrow={1}>
              <BudgetOverlay onClose={() => store.getState().setOverlay(null)} />
            </Box>
          ) : overlay === "review" ? (
            <Box flexDirection="column" flexGrow={1}>
              <ReviewOverlay onClose={() => store.getState().setOverlay(null)} />
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
        </Box>
        </Box>
        {/* Right inspector — full height: from the top margin down to just above
            the status bar. */}
        {rightVisible && <SidePanel height={Math.max(1, termRows - FOOTER_ROWS)} />}
      </Box>
      {/* Full-width status bar pinned to the very bottom row (VS Code-style): tab
          chip + cwd pill + hints on the left, a right-aligned health badge. */}
      {(() => {
        const idxChip = `[${manager.activeIndex + 1}/${manager.tabs.length}]`;
        const cwdPad = ` ${cwdLabel} `;
        const branchStr = branch ? ` ⎇ ${branch}` : "";
        const hints = isTerm
          ? ` · Ctrl+\\ leader · ^K cmds · ^G help · ^Q quit`
          : ` · MODE ${mode} · ^E explorer · ^K cmds · ^G help · ^Q quit`;
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
