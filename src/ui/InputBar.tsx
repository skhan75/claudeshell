import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Keycap, FilledLine, SIDEBAR_WIDTH, INPUT_BORDER, INPUT_BORDER_FOCUS, INPUT_BG } from "./chrome.js";
import { fuzzyFilter } from "../core/fuzzy.js";
import { listProjectFilesCached } from "../core/files.js";
import { effectiveSlashCommands, routeSlash } from "../core/slash-commands.js";
import { execSlash } from "./execSlash.js";
import * as edit from "../core/line-edit.js";
import type { LineState } from "../core/line-edit.js";

export function InputBar({ width: widthProp }: { width?: number } = {}) {
  const { manager, config, store } = useAppCtx();
  useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const tabLeader = useApp((s) => s.tabLeader);
  const { stdout } = useStdout();
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0); // caret index into `text`
  // Selection index into the currently-shown suggestion list (whichever picker
  // is active). Reset to 0 whenever the query changes so it never dangles past
  // the end of a shrunk list.
  const [sel, setSel] = useState(0);
  // When set, the user pressed Esc to dismiss a picker; suppress suggestions
  // until the query changes again (so the next Enter sends normally).
  const [dismissed, setDismissed] = useState(false);
  // Submitted-prompt history for ↑/↓ recall. histIdx === null means "editing a
  // fresh line"; reset both when the active session changes.
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const session = manager.active;
  const focused = focus === "input";

  useEffect(() => {
    setHistory([]);
    setHistIdx(null);
  }, [session?.id]);

  // Slash source: the live list the SDK reports on the session's transcript meta
  // when available, else the built-in fallback so the picker works on a fresh tab.
  const slashCommands = effectiveSlashCommands(session?.transcript.meta.slashCommands ?? []);
  const slashSuggestions =
    !dismissed && text.startsWith("/") && !text.includes(" ")
      ? fuzzyFilter(slashCommands, text.slice(1), (c) => c.slice(1)).slice(0, 8)
      : [];

  // Live @-file picker: the current word (last space-separated token); if it
  // starts with "@", surface matching project files as the user types — even on
  // a bare "@" (word.slice(1) === "" → fuzzyFilter returns all → first 8).
  const words = text.split(" ");
  const currentWord = words[words.length - 1];
  const atActive = !dismissed && currentWord.startsWith("@") && !!session;
  const fileSuggestions = atActive
    ? fuzzyFilter(listProjectFilesCached(session!.cwd), currentWord.slice(1), (f) => f).slice(0, 8)
    : [];

  // Unified picker model: at most one is visible at a time. @ takes precedence
  // when the current word is an @-token; otherwise the slash picker. The same
  // sel/Up/Down/Enter/Tab logic drives both — only the insertion differs.
  type Picker = "file" | "slash";
  const picker: Picker | null =
    fileSuggestions.length > 0 ? "file" : slashSuggestions.length > 0 ? "slash" : null;
  const suggestions = picker === "file" ? fileSuggestions : picker === "slash" ? slashSuggestions : [];
  // Clamp the rendered/selected index defensively (a stale sel from before a
  // keystroke could otherwise point past a freshly-shrunk list mid-render).
  const selIdx = suggestions.length > 0 ? Math.min(sel, suggestions.length - 1) : 0;

  const isActive =
    focused &&
    !paletteOpen &&
    !manager.active?.pendingPermission &&
    session?.status !== "crashed";

  // Set the whole line (caret defaults to the end) — used by history recall + picker insert.
  const setLine = (t: string, c: number = t.length) => {
    setText(t);
    setCursor(c);
  };
  // Apply a pure line-edit op to the current { text, cursor }.
  const applyEdit = (fn: (s: LineState) => LineState) => {
    const next = fn({ text, cursor });
    setText(next.text);
    setCursor(next.cursor);
  };
  // A text-changing edit also resets the picker selection / dismiss / history index.
  const editText = (fn: (s: LineState) => LineState) => {
    applyEdit(fn);
    setSel(0);
    setDismissed(false);
    setHistIdx(null);
  };
  // Replace text with a new value as a fresh query; reset selection.
  const setQuery = (next: string) => {
    setLine(next);
    setSel(0);
    setDismissed(false);
  };

  // App-handled slash commands run a real action via the single router (the SDK query
  // can't run CLI slash commands). Returns true if handled — both the picker-Enter and
  // the top-level Enter route through here; arg commands (/parallel <task>) only reach
  // the top-level path since the inline picker closes as soon as the text has a space.
  const runSlash = (cmd: string): boolean => execSlash(routeSlash(cmd), { manager, config, store });

  const clearInput = () => {
    setLine("");
    setSel(0);
    setDismissed(false);
    setHistIdx(null);
  };

  // Insert the highlighted suggestion into the input, replacing the active
  // token, and append a trailing space (which dismisses the picker naturally).
  const insertSelected = () => {
    if (picker === "file") {
      const ws = text.split(" ");
      ws[ws.length - 1] = "@" + suggestions[selIdx];
      setQuery(ws.join(" ") + " ");
    } else if (picker === "slash") {
      setQuery(suggestions[selIdx] + " ");
    }
  };

  useInput(
    (input, key) => {
      // Stand down while the Ctrl+Space tab-cycle leader is armed so ←/→ cycles tabs
      // (App handles it) instead of moving the caret.
      if (tabLeader) return;
      // While a picker is open it owns navigation + Enter/Tab/Esc.
      if (picker) {
        if (key.upArrow || (key.ctrl && input === "p")) {
          setSel((s) => Math.max(0, Math.min(s, suggestions.length - 1) - 1));
          return;
        }
        if (key.downArrow || (key.ctrl && input === "n")) {
          setSel((s) => Math.min(suggestions.length - 1, s + 1));
          return;
        }
        if (key.return || key.tab) {
          // Enter on an app-handled command (e.g. /model) runs it instead of inserting.
          if (key.return && picker === "slash" && runSlash(suggestions[selIdx])) {
            clearInput();
            return;
          }
          insertSelected();
          return;
        }
        if (key.escape) {
          // Dismiss the picker without sending; the next Enter sends normally.
          setDismissed(true);
          return;
        }
        // Fall through to text editing for any other key (backspace/printable).
      }

      if (key.return) {
        const t = text.trim();
        // App-handled slash commands run their action (the SDK query can't process
        // CLI slash commands, so we never send those as prompts).
        if (t !== "" && runSlash(t)) {
          clearInput();
          return;
        }
        if (t !== "") {
          session?.send(t);
          setHistory((h) => (h[h.length - 1] === t ? h : [...h, t]));
        }
        clearInput();
        return;
      }
      // ↑/↓ (no picker open) walk the submitted-prompt history.
      if (key.upArrow) {
        if (history.length === 0) return;
        const idx = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
        setLine(history[idx]);
        setHistIdx(idx);
        setSel(0);
        setDismissed(false);
        return;
      }
      if (key.downArrow) {
        if (histIdx === null) return;
        if (histIdx < history.length - 1) {
          const idx = histIdx + 1;
          setLine(history[idx]);
          setHistIdx(idx);
        } else {
          setHistIdx(null);
          setLine("");
        }
        setSel(0);
        setDismissed(false);
        return;
      }
      if (key.tab) {
        // No picker is open here (the picker branch above already consumed Tab).
        // Complete the active @/slash token if one is present; otherwise do nothing.
        if (picker) insertSelected();
        return;
      }
      // --- caret motion (no text change) — char-wise, or word-wise with Option/Alt ---
      if (key.leftArrow) { applyEdit(key.meta ? edit.moveWordLeft : edit.moveLeft); return; }
      if (key.rightArrow) { applyEdit(key.meta ? edit.moveWordRight : edit.moveRight); return; }
      if (key.ctrl && input === "a") { applyEdit(edit.moveHome); return; } // line start
      // --- fast deletes (editor-like) ---
      if (key.meta && (key.backspace || key.delete)) { editText(edit.deleteWordLeft); return; } // Option+Delete
      if (key.ctrl && input === "w") { editText(edit.deleteWordLeft); return; } // Ctrl+W: word back
      if (key.ctrl && input === "u") { editText(edit.deleteToStart); return; } // Ctrl+U: to line start
      if (key.ctrl && input === "d") { editText(edit.del); return; } // Ctrl+D: forward delete
      if (key.backspace || key.delete) { editText(edit.backspace); return; }
      // --- printable insert at the caret ---
      if (input && !key.ctrl && !key.meta) { editText((s) => edit.insert(s, input)); return; }
    },
    { isActive }
  );

  const footerModel = session?.transcript.meta.model ?? config.models[0] ?? "—";

  // Composer box geometry. App passes a frame-aware width; the fallback mirrors it
  // for tests/standalone. The interior is filled (INPUT_BG) by padding a Text line
  // to the content width — Ink can only paint a background on <Text>, not <Box>.
  const cols = stdout?.columns ?? 80;
  const boxWidth = widthProp ?? Math.max(24, cols - SIDEBAR_WIDTH - 2);
  const inner = Math.max(8, boxWidth - 2); // cells inside the round border
  const PLACEHOLDER = "type a message…";
  // Single-line view that scrolls horizontally so the caret stays visible; the caret
  // renders as a block on the character under it (or a bar at end-of-line).
  const maxText = Math.max(1, inner - 4); // " ▸ " prefix + caret cell
  const { slice, caret } = edit.windowText(text, cursor, maxText);
  const atEnd = caret >= slice.length;
  const pre = slice.slice(0, caret);
  const curCh = atEnd ? "" : slice[caret];
  const post = atEnd ? "" : slice.slice(caret + 1);
  const caretCells = atEnd ? (focused ? 1 : 0) : 1;
  const contentLen = 1 + 2 + pre.length + caretCells + post.length + (text === "" ? PLACEHOLDER.length : 0);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={focused ? INPUT_BORDER_FOCUS : INPUT_BORDER} width={boxWidth}>
        <FilledLine bg={INPUT_BG} trail={inner - contentLen}>
          <Text> </Text>
          <Text color={theme.accent} bold>▸ </Text>
          <Text color={theme.fg}>{pre}</Text>
          {!atEnd &&
            (focused ? (
              <Text inverse color={theme.accent}>{curCh}</Text>
            ) : (
              <Text color={theme.fg}>{curCh}</Text>
            ))}
          {!atEnd && <Text color={theme.fg}>{post}</Text>}
          {atEnd && focused && <Text color={theme.accent}>▋</Text>}
          {text === "" && <Text color={theme.dim}>{PLACEHOLDER}</Text>}
        </FilledLine>
      </Box>
      {picker === "slash" && (
        <Box flexDirection="column" paddingX={1}>
          {suggestions.map((s, i) => (
            <Text key={s} color={i === selIdx ? theme.accent : theme.dim} inverse={i === selIdx}>
              {i === selIdx ? "› " : "  "}
              {s}
            </Text>
          ))}
        </Box>
      )}
      {picker === "file" && (
        <Box flexDirection="column" paddingX={1}>
          <Text color={theme.dim}>@ files</Text>
          {suggestions.map((f, i) => (
            <Text key={f} color={i === selIdx ? theme.accent : theme.dim} inverse={i === selIdx}>
              {i === selIdx ? "› " : "  "}
              {f}
            </Text>
          ))}
        </Box>
      )}
      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <Keycap label="↑" />
          <Text> </Text>
          <Keycap label="↓" />
          <Text color={theme.dim}> history</Text>
          <Text>   </Text>
          <Keycap label="Tab" />
          <Text color={theme.dim}> autocomplete</Text>
          <Text>   </Text>
          <Keycap label="/" />
          <Text color={theme.dim}> cmds</Text>
          <Text>   </Text>
          <Keycap label="@" />
          <Text color={theme.dim}> paths</Text>
        </Box>
        <Text color={theme.dim}>
          <Text color={theme.good}>● </Text>Model: <Text color={theme.accent}>{footerModel}</Text>
        </Text>
      </Box>
    </Box>
  );
}
