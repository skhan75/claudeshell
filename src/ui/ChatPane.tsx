import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import type { TranscriptBlock } from "../core/types.js";
import type { Layout } from "../store.js";

export interface Line {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  italic?: boolean;
}

/**
 * Returns the number of terminal rows consumed by chrome around the ChatPane.
 * zen layout adds one extra row (TelemetryStrip sits below the tab bar in zen
 * but is counted separately from the input area). This is exported so tests
 * can pin the value without relying on terminal row mocking.
 */
export function chromeRows(layout: Layout): number {
  return layout === "zen" ? 9 : 8;
}

export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= w) {
      out.push(raw);
      continue;
    }
    let line = raw;
    while (line.length > w) {
      out.push(line.slice(0, w));
      line = line.slice(w);
    }
    out.push(line);
  }
  return out;
}

export function blockLines(b: TranscriptBlock, width: number): Line[] {
  // Body text is indented under its role header by a `│ ` rule (2 cols), so wrap
  // the body to width-2 to keep the rendered turn inside the pane width.
  const bodyWidth = Math.max(1, width - 2);
  switch (b.kind) {
    case "user": {
      const lines: Line[] = [{ text: "▸ OPERATOR", color: theme.warn, bold: true }];
      for (const t of wrapText(b.text, bodyWidth)) {
        lines.push({ text: `│ ${t}`, color: theme.warn });
      }
      return lines;
    }
    case "assistant": {
      const lines: Line[] = [{ text: "◉ CLAUDE", color: theme.accent, bold: true }];
      const body = wrapText(b.text + (b.streaming ? "▋" : ""), bodyWidth);
      for (const t of body) {
        // Preserve +/- diff coloring on the body text itself; the `│ ` rule stays accent.
        const color = t.startsWith("+") ? theme.good : t.startsWith("-") ? theme.bad : theme.fg;
        lines.push({ text: `│ ${t}`, color });
      }
      return lines;
    }
    case "tool":
      return [{
        text: `⚙ ${b.name} ${b.detail} ${b.status === "running" ? "…" : "✓"}`.slice(0, width),
        color: theme.purple,
      }];
    case "thinking": {
      // Live reasoning display: dim + italic, distinct from the answer. First line
      // carries the ✻ marker, continuations align under it with a 2-space indent.
      const wrapped = wrapText(b.text + (b.streaming ? "▋" : ""), bodyWidth);
      return wrapped.map((t, i) => ({
        text: (i === 0 ? "✻ " : "  ") + t,
        dim: true,
        italic: true,
      }));
    }
    case "info":
      // Error-ish info (✖ …) reads in bad; ordinary info stays dim.
      return wrapText(b.text, width).map((t) =>
        b.text.startsWith("✖") ? { text: t, color: theme.bad } : { text: t, dim: true },
      );
  }
}

export function ChatPane({ height: heightProp }: { height?: number }) {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const layout = useApp((s) => s.layout);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const { stdout } = useStdout();
  const session = manager.active;

  const cols = stdout?.columns ?? 80;
  const width = Math.max(20, layout === "sidebar" ? cols - 32 : cols - 2);
  // rows - chromeRows: zen has one extra chrome row (TelemetryStrip sits above the input
  // in that layout); chromeRows() is exported as a pure helper for testability.
  const height = heightProp ?? Math.max(6, (stdout?.rows ?? 24) - chromeRows(layout));

  const [offset, setOffset] = useState(0); // lines scrolled up from bottom
  const [search, setSearch] = useState({ active: false, query: "" });
  // matchIdx is the index into the matches[] array (not the line index) so that
  // n/N cycle through ALL matches instead of re-deriving from viewport top.
  const [matchIdx, setMatchIdx] = useState(0);

  useEffect(() => {
    setOffset(0);
    setSearch({ active: false, query: "" });
    setMatchIdx(0);
  }, [session?.id]);

  // PERF(v1.1): rebuilt on every render; during streaming this re-wraps the whole
  // transcript per delta. Fine for short sessions — memoize prefix wrapping (all
  // blocks except the streaming tail) before long-session support.
  const lines: Line[] = [];
  const blocks = session?.transcript.blocks ?? [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // Blank spacer between turns: precede each conversational turn header
    // (operator / claude / thinking) with one empty line for clear separation.
    if (i > 0 && (b.kind === "user" || b.kind === "assistant" || b.kind === "thinking")) {
      lines.push({ text: "" });
    }
    lines.push(...blockLines(b, width));
  }
  const maxOffset = Math.max(0, lines.length - height);

  const jump = (dir: 1 | -1) => {
    const q = search.query.toLowerCase();
    if (!q) return;
    const matches = lines
      .map((l, i) => (l.text.toLowerCase().includes(q) ? i : -1))
      .filter((i) => i >= 0);
    if (matches.length === 0) return;
    // Advance or retreat the selected match index with modulo wrap so that every
    // press of n/N moves to a DIFFERENT match, regardless of scroll position.
    const nextIdx = ((matchIdx + dir) % matches.length + matches.length) % matches.length;
    setMatchIdx(nextIdx);
    const targetLine = matches[nextIdx];
    setOffset(Math.max(0, Math.min(maxOffset, lines.length - height - targetLine)));
  };

  useInput(
    (input, key) => {
      if (search.active) {
        if (key.escape) { setSearch({ active: false, query: "" }); setMatchIdx(0); }
        else if (key.return) setSearch((s) => ({ ...s, active: false }));
        else if (key.backspace || key.delete) { setSearch((s) => ({ ...s, query: s.query.slice(0, -1) })); setMatchIdx(0); }
        else if (input && !key.ctrl && !key.meta) { setSearch((s) => ({ ...s, query: s.query + input })); setMatchIdx(0); }
        return;
      }
      if (key.escape && search.query !== "") {
        setSearch({ active: false, query: "" });
        setMatchIdx(0);
        return;
      }
      if (input === "j") setOffset((o) => Math.max(0, o - 1));
      else if (input === "k") setOffset((o) => Math.min(maxOffset, o + 1));
      else if (input === "G") setOffset(0);
      else if (input === "g") setOffset(maxOffset);
      else if (key.ctrl && input === "d") setOffset((o) => Math.max(0, o - Math.floor(height / 2)));
      else if (key.ctrl && input === "u") setOffset((o) => Math.min(maxOffset, o + Math.floor(height / 2)));
      else if (input === "/") setSearch({ active: true, query: "" });
      else if (input === "n") jump(1);
      else if (input === "N") jump(-1);
    },
    { isActive: focus === "scroll" && !paletteOpen && !manager.active?.pendingPermission }
  );

  const start = Math.max(0, lines.length - height - offset);
  const visible = lines.slice(start, start + height);
  const q = search.query.toLowerCase();

  return (
    <Box flexDirection="column" height={height + (search.active || search.query ? 1 : 0)}>
      {visible.map((l, i) => (
        <Text
          key={start + i}
          color={l.color}
          dimColor={l.dim}
          bold={l.bold}
          italic={l.italic}
          inverse={q !== "" && l.text.toLowerCase().includes(q)}
        >
          {l.text || " "}
        </Text>
      ))}
      {(search.active || search.query !== "") && (
        <Text color={theme.accent}>/{search.query}{search.active ? "▋" : `  (n/N to jump)`}</Text>
      )}
    </Box>
  );
}
