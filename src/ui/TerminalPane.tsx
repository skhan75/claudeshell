import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout, type Key } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { Panel } from "./chrome.js";
import { theme } from "./theme.js";

/** Last two path segments of a cwd, e.g. /a/b/c/d → c/d. */
function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || "/";
}

/**
 * Reconstruct the raw byte sequence to forward to a PTY from an Ink key event.
 * Returns "" for events that carry nothing meaningful to send.
 */
function bytesFor(input: string, key: Key): string {
  if (key.return) return "\r";
  if (key.tab) return "\t";
  if (key.backspace) return "\x7f";
  if (key.delete) return "\x1b[3~";
  if (key.escape) return "\x1b";
  if (key.upArrow) return "\x1b[A";
  if (key.downArrow) return "\x1b[B";
  if (key.rightArrow) return "\x1b[C";
  if (key.leftArrow) return "\x1b[D";
  if (key.pageUp) return "\x1b[5~";
  if (key.pageDown) return "\x1b[6~";
  // Ctrl + a-z → control byte (Ctrl+A=\x01 … Ctrl+Z=\x1a).
  if (key.ctrl && /^[a-z]$/i.test(input)) {
    return String.fromCharCode(input.toLowerCase().charCodeAt(0) - 96);
  }
  // Alt/Meta + char → ESC prefix.
  if (key.meta && input) return "\x1b" + input;
  // Printable text — pass through verbatim.
  if (input) return input;
  return "";
}

/**
 * The live screen for the active terminal tab. Renders the headless xterm
 * snapshot and routes keystrokes to the PTY, with a tmux-style Ctrl+\ leader
 * for openshell commands.
 */
export function TerminalPane({ height, onQuit }: { height: number; onQuit?: () => void }) {
  const { manager, store } = useAppCtx();
  useApp((s) => s.version);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const overlay = useApp((s) => s.overlay);
  const pending = manager.active?.pendingPermission ?? null;

  const [leaderPending, setLeaderPending] = useState(false);

  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  const activeTab = manager.activeTab;
  const isTerm = activeTab?.kind === "terminal";
  const terminal = isTerm ? activeTab : undefined;

  // 1-line title + top/bottom borders → reserve 2 cols / 2 rows for the box.
  const cols = Math.max(20, termWidth - 2);
  const rows = Math.max(4, height - 2);

  // Keep the PTY/screen buffer matched to the visible pane so full-screen apps
  // (vim, htop, less) lay out correctly. Keyed on dimensions + terminal identity.
  useEffect(() => {
    terminal?.resize(cols, rows);
  }, [cols, rows, terminal]);

  useInput(
    (input, key) => {
      if (!terminal) return;
      // Leader = Ctrl+\. Ink reports it as key.ctrl + "\\" OR (when the raw 0x1c
      // FS byte arrives) as a bare "\x1c" with key.ctrl=false — accept both.
      const isLeader = (key.ctrl && input === "\\") || input === "\x1c";

      if (leaderPending) {
        setLeaderPending(false);
        const st = store.getState();
        if (/^[1-9]$/.test(input)) {
          manager.activate(Number(input) - 1);
        } else if (input === "t") {
          manager.createTerminal();
        } else if (input === "c") {
          manager.create();
        } else if (input === "w") {
          manager.close(terminal.id);
        } else if (input === "g") {
          st.setOverlay("help");
        } else if (input === "k") {
          st.setPaletteOpen(true);
        } else if (input === "r") {
          st.setOverlay("sessions");
        } else if (input === "b") {
          st.setOverlay("buffers");
        } else if (input === "q") {
          onQuit?.();
        } else if (isLeader) {
          // Leader twice → send a literal 0x1c to the program.
          terminal.write("\x1c");
        }
        // Escape or any other key → cancel (already consumed by clearing pending).
        return;
      }

      if (isLeader) {
        setLeaderPending(true);
        return;
      }

      const bytes = bytesFor(input, key);
      if (bytes) terminal.write(bytes);
    },
    { isActive: isTerm && !paletteOpen && !overlay && !pending }
  );

  if (!terminal) return null;

  const snap = terminal.snapshot();
  const lines = snap.lines.slice(0, rows);
  const exited = terminal.status === "exited";

  return (
    <Panel accent flexGrow={1}>
      {/* Leading space: Ink drops the first content cell of a bordered pane that
          sits under the header's left box (an output-diff quirk reproduced in
          tests); the space absorbs the drop so the title text stays intact. */}
      <Text>
        {" "}
        <Text color={theme.accent} bold>{`TERM ${terminal.id}`}</Text>
        <Text color={theme.dim}>{` — ${shortCwd(terminal.cwd)}`}</Text>
        {exited && <Text color={theme.dim}> [exited]</Text>}
      </Text>
      {leaderPending && (
        <Text color={theme.dim} wrap="truncate">
          LEADER · 1-9 tab · b buffers · t term · c claude · w close · g help · k palette · q quit
        </Text>
      )}
      {lines.map((line, i) => (
        // Empty line → a single space so Ink keeps the row height.
        <Text key={i} wrap="truncate">
          {line.length > 0 ? line : " "}
        </Text>
      ))}
    </Panel>
  );
}
