import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { renderMarkdown } from "./markdown.js";
import { wrapSpans, lineText, type Span, type Line } from "./wrap-spans.js";
import type { TranscriptBlock } from "../core/types.js";
import type { Layout } from "../store.js";

export type { Span, Line };

/**
 * Returns the number of terminal rows consumed by chrome around the ChatPane.
 * zen layout adds one extra row (TelemetryStrip sits below the tab bar in zen
 * but is counted separately from the input area). This is exported so tests
 * can pin the value without relying on terminal row mocking.
 */
export function chromeRows(layout: Layout): number {
  return layout === "zen" ? 9 : 8;
}

/** Plain hard-wrap (byte slicing) — kept for non-markdown callers and tests. */
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

/** HH:MM:SS for a block timestamp; "" when absent. */
function fmtTime(n?: number): string {
  return n ? new Date(n).toLocaleTimeString("en-GB", { hour12: false }) : "";
}

/**
 * Render one transcript block to styled content lines (NO left rule — ChatPane
 * prepends the role rule during assembly). Assistant bodies go through the
 * markdown renderer; everything else is plain styled text.
 */
export function blockLines(b: TranscriptBlock, width: number): Line[] {
  const bodyWidth = Math.max(1, width - 2); // body sits under the `│ ` rule
  switch (b.kind) {
    case "user": {
      const head: Span[] = [{ text: "▸ OPERATOR", color: theme.warn, bold: true }];
      const t = fmtTime(b.ts);
      if (t) head.push({ text: `  ${t}`, color: theme.dim, dim: true });
      const lines: Line[] = [{ spans: head }];
      for (const l of wrapSpans([{ text: b.text, color: theme.warn }], bodyWidth)) lines.push(l);
      return lines;
    }
    case "assistant": {
      const head: Span[] = [{ text: "◉ CLAUDE", color: theme.accent, bold: true }];
      const t = fmtTime(b.ts);
      if (t) head.push({ text: `  ${t}`, color: theme.dim, dim: true });
      const lines: Line[] = [{ spans: head }];
      lines.push(...renderMarkdown(b.text, bodyWidth));
      if (b.streaming) {
        const last = lines[lines.length - 1];
        if (last && last !== lines[0]) last.spans.push({ text: "▋", color: theme.accent });
        else lines.push({ spans: [{ text: "▋", color: theme.accent }] });
      }
      return lines;
    }
    case "tool":
      return [{
        spans: [{
          text: `⚙ ${b.name} ${b.detail} ${b.status === "running" ? "…" : "✓"}`.slice(0, width),
          color: theme.purple,
        }],
      }];
    case "thinking": {
      const wrapped = wrapSpans([{ text: b.text, dim: true, italic: true }], bodyWidth);
      const lines: Line[] = wrapped.map((l, i) => ({
        spans: [{ text: i === 0 ? "✻ " : "  ", dim: true, italic: true }, ...l.spans],
      }));
      if (b.streaming && lines.length) lines[lines.length - 1].spans.push({ text: "▋", dim: true });
      return lines;
    }
    case "info":
      return wrapSpans(
        [{ text: b.text, ...(b.text.startsWith("✖") ? { color: theme.bad } : { dim: true }) }],
        width,
      );
  }
}

/**
 * Cache assistant markdown rendering per block. blockLines for an assistant block
 * runs the marked parser, which would otherwise re-run for EVERY block on EVERY
 * streaming delta (O(blocks×deltas)). Keyed by the (stable, mutated-in-place)
 * block object; recomputed only when its text/width/streaming actually change —
 * so finalized blocks are O(1) and only the streaming tail re-renders.
 */
const assistantCache = new WeakMap<TranscriptBlock, { text: string; width: number; streaming: boolean; lines: Line[] }>();

function cachedBlockLines(b: TranscriptBlock, width: number): Line[] {
  if (b.kind !== "assistant") return blockLines(b, width);
  const hit = assistantCache.get(b);
  if (hit && hit.text === b.text && hit.width === width && hit.streaming === b.streaming) return hit.lines;
  const lines = blockLines(b, width);
  assistantCache.set(b, { text: b.text, width, streaming: b.streaming, lines });
  return lines;
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
  // Sidebar occupies 34 cols; subtract the full panel width so rule+body never
  // overflows the chat column. Zen keeps a 1-col breathing margin each side.
  const width = Math.max(20, layout === "sidebar" ? cols - 34 : cols - 2);
  const total = heightProp ?? Math.max(6, (stdout?.rows ?? 24) - chromeRows(layout));
  // Reserve one row for the "AI Dialogue" header; the scroll buffer gets the rest.
  const HEADER_ROWS = 1;
  const height = Math.max(3, total - HEADER_ROWS);

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

  // PERF(v1.1): rebuilt on every render; during streaming this re-renders the whole
  // transcript per delta. Fine for short sessions — memoize prefix rendering (all
  // blocks except the streaming tail) before long-session support.
  const lines: Line[] = [];
  const blocks = session?.transcript.blocks ?? [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // Blank spacer between turns: precede each conversational turn header
    // (operator / claude / thinking) with one empty line for clear separation.
    if (i > 0 && (b.kind === "user" || b.kind === "assistant" || b.kind === "thinking")) {
      lines.push({ spans: [] });
    }
    // Prepend the role rule to body lines (index > 0); the header line is bare.
    const ruled = b.kind === "user" || b.kind === "assistant";
    const ruleColor = b.kind === "user" ? theme.warn : theme.accent;
    cachedBlockLines(b, width).forEach((l, j) => {
      if (ruled && j > 0) lines.push({ spans: [{ text: "│ ", color: ruleColor }, ...l.spans] });
      else lines.push(l);
    });
  }
  const maxOffset = Math.max(0, lines.length - height);

  const jump = (dir: 1 | -1) => {
    const q = search.query.toLowerCase();
    if (!q) return;
    const matches = lines
      .map((l, i) => (lineText(l).toLowerCase().includes(q) ? i : -1))
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

  // Chat header: "● AI Dialogue" left, "Session #<id>" right (computed padding).
  const sid = (session?.claudeSessionId ?? session?.id ?? "").slice(-6);
  const headLeft = "● AI Dialogue";
  const headRight = sid ? `Session #${sid}` : "";
  const headPad = " ".repeat(Math.max(1, width - headLeft.length - headRight.length));

  return (
    <Box flexDirection="column" height={total + (search.active || search.query ? 1 : 0)}>
      <Text wrap="truncate">
        <Text color={theme.good}>● </Text>
        <Text color={theme.fg} bold>AI Dialogue</Text>
        {headPad}
        <Text color={theme.dim}>{headRight}</Text>
      </Text>
      {visible.map((l, i) => {
        const hit = q !== "" && lineText(l).toLowerCase().includes(q);
        const spans = l.spans.length ? l.spans : [{ text: " " } as Span];
        return (
          <Box key={start + i}>
            {spans.map((s, j) => (
              <Text
                key={j}
                color={s.color}
                backgroundColor={s.bg}
                dimColor={s.dim}
                bold={s.bold}
                italic={s.italic}
                underline={s.underline}
                strikethrough={s.strikethrough}
                inverse={hit}
              >
                {s.text || " "}
              </Text>
            ))}
          </Box>
        );
      })}
      {(search.active || search.query !== "") && (
        <Text color={theme.accent}>/{search.query}{search.active ? "▋" : `  (n/N to jump)`}</Text>
      )}
    </Box>
  );
}
