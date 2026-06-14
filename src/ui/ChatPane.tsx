import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { renderMarkdown } from "./markdown.js";
import { wrapSpans, lineText, type Span, type Line } from "./wrap-spans.js";
import { SIDEBAR_WIDTH } from "./chrome.js";
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

/** Last two path segments, e.g. /a/b/c/d.ts → c/d.ts. */
function shortFile(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length <= 2 ? p : parts.slice(-2).join("/");
}

/** Clip a string to `w` cells with an ellipsis. */
function clip(s: string, w: number): string {
  return s.length > w ? s.slice(0, Math.max(1, w - 1)) + "…" : s;
}

const RICH_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"]);
const MAX_TOOL_BODY = 16; // cap a tool's diff/output, with a "+N more" footer

/**
 * Render a tool call like the CLI shows its work: a header (⚙ name · file · status)
 * plus the actual change — a green/red diff for Edit/Write, the command + output for
 * Bash — straight from the SDK's structured tool input/result. Read-only tools
 * (Read/Grep/Glob/…) stay a terse one-liner. Output is capped to keep it scannable.
 */
export function toolLines(
  b: Extract<TranscriptBlock, { kind: "tool" }>,
  width: number,
): Line[] {
  const running = b.status === "running";
  const errored = b.ok === false;
  const glyph = running ? "…" : errored ? "✖" : "✓";
  const glyphColor = running ? theme.dim : errored ? theme.bad : theme.good;
  const input = b.input ?? {};
  const w = Math.max(8, width);
  const bodyW = Math.max(8, width - 2);

  if (!RICH_TOOLS.has(b.name)) {
    // Terse one-liner for read-only / non-diff tools, keeping the summarized detail.
    return [{
      spans: [
        { text: clip(`⚙ ${b.name} ${b.detail}`, w - 2), color: theme.purple },
        { text: ` ${glyph}`, color: glyphColor },
      ],
    }];
  }

  const file = typeof input.file_path === "string" ? shortFile(input.file_path) : "";
  const lines: Line[] = [{
    spans: [
      { text: "⚙ ", color: theme.purple },
      { text: b.name, color: theme.purple, bold: true },
      ...(file ? [{ text: " " + clip(file, Math.max(6, w - b.name.length - 6)), color: theme.accent }] : []),
      { text: ` ${glyph}`, color: glyphColor },
    ],
  }];

  const body: { text: string; color: string }[] = [];
  const diff = (oldS: string, newS: string) => {
    for (const l of oldS ? oldS.split("\n") : []) body.push({ text: "- " + l, color: theme.bad });
    for (const l of newS ? newS.split("\n") : []) body.push({ text: "+ " + l, color: theme.good });
  };
  if (b.name === "Edit" || b.name === "NotebookEdit") {
    diff(String(input.old_string ?? input.old_source ?? ""), String(input.new_string ?? input.new_source ?? ""));
  } else if (b.name === "MultiEdit" && Array.isArray(input.edits)) {
    for (const e of input.edits as Array<Record<string, unknown>>) diff(String(e.old_string ?? ""), String(e.new_string ?? ""));
  } else if (b.name === "Write" && typeof input.content === "string") {
    for (const l of input.content.split("\n")) body.push({ text: "+ " + l, color: theme.good });
  } else if (b.name === "Bash" && typeof input.command === "string") {
    body.push({ text: "$ " + input.command, color: theme.fg });
    if (b.result) for (const l of b.result.replace(/\n+$/, "").split("\n")) body.push({ text: l, color: errored ? theme.bad : theme.dim });
  }

  const shown = body.slice(0, MAX_TOOL_BODY);
  for (const x of shown) lines.push({ spans: [{ text: "  " + clip(x.text, bodyW), color: x.color }] });
  if (body.length > shown.length) {
    lines.push({ spans: [{ text: `  … +${body.length - shown.length} more lines`, color: theme.dim }] });
  }
  return lines;
}

/**
 * Render one transcript block to styled content lines — clean and minimal, like
 * the Claude CLI: user prompts get a simple `❯` marker, assistant answers are
 * rendered markdown, no role banners or rules.
 */
export function blockLines(b: TranscriptBlock, width: number): Line[] {
  switch (b.kind) {
    case "user": {
      // Echo the prompt with a "❯ " marker; wrapped continuations hang-indent by 2.
      const wrapped = wrapSpans([{ text: b.text, color: theme.fg }], Math.max(1, width - 2));
      return wrapped.map((l, i) => ({
        spans: i === 0
          ? [{ text: "▸ ", color: theme.accent, bold: true }, ...l.spans]
          : [{ text: "  " }, ...l.spans],
      }));
    }
    case "assistant": {
      const lines = renderMarkdown(b.text, width);
      if (b.streaming && lines.length) {
        // Append the cursor to a COPY of the last line (renderMarkdown may return
        // a shared blank-line constant — never mutate it in place).
        const last = lines[lines.length - 1];
        lines[lines.length - 1] = { spans: [...last.spans, { text: "▋", color: theme.accent }] };
      }
      return lines;
    }
    case "tool":
      return toolLines(b, width);
    case "thinking": {
      const wrapped = wrapSpans([{ text: b.text, dim: true, italic: true }], Math.max(1, width - 2));
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

export function ChatPane({ height: heightProp, width: widthProp }: { height?: number; width?: number }) {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const layout = useApp((s) => s.layout);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const { stdout } = useStdout();
  const session = manager.active;

  const cols = stdout?.columns ?? 80;
  // The text-area width. App passes an explicit (frame-aware) width; the fallback
  // mirrors it for tests/standalone: sidebar occupies SIDEBAR_WIDTH cols, zen keeps
  // a 1-col breathing margin each side.
  const width = widthProp ?? Math.max(20, layout === "sidebar" ? cols - SIDEBAR_WIDTH : cols - 2);
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

  // PERF(v1.1): rebuilt on every render; during streaming this re-renders the whole
  // transcript per delta. Fine for short sessions — memoize prefix rendering (all
  // blocks except the streaming tail) before long-session support.
  // Reserve one column on the right for the scroll gutter so wrapping is stable
  // whether or not the transcript currently overflows (no reflow at the boundary).
  const contentWidth = Math.max(20, width - 1);
  const lines: Line[] = [];
  const blocks = session?.transcript.blocks ?? [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // One blank line between turns for clean separation (CLI-style).
    if (i > 0 && (b.kind === "user" || b.kind === "assistant" || b.kind === "thinking")) {
      lines.push({ spans: [] });
    }
    for (const l of cachedBlockLines(b, contentWidth)) lines.push(l);
  }
  const maxOffset = Math.max(0, lines.length - height);
  const effOffset = Math.min(offset, maxOffset); // clamp a stale offset after a resize
  const overflow = maxOffset > 0;

  // Snap back to the latest whenever the user sends a new prompt, so the reply is
  // visible even if they had scrolled up to read earlier history while composing.
  const userCount = blocks.reduce((n, b) => (b.kind === "user" ? n + 1 : n), 0);
  useEffect(() => {
    setOffset(0);
  }, [userCount]);

  const page = Math.max(1, height - 1); // PgUp/PgDn step (one line of overlap)
  const half = Math.max(1, Math.floor(height / 2)); // Ctrl+D/Ctrl+U step

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
      // Page keys scroll the transcript from ANY focus — you can flick through the
      // backlog while still composing in the input bar (no mode switch needed).
      if (key.pageUp) {
        setOffset((o) => Math.min(maxOffset, o + page));
        return;
      }
      if (key.pageDown) {
        setOffset((o) => Math.max(0, o - page));
        return;
      }
      // The vim-style keys below only apply once focus is in the transcript (Esc).
      if (focus !== "scroll") return;
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
      if (input === "j" || key.downArrow) setOffset((o) => Math.max(0, o - 1));
      else if (input === "k" || key.upArrow) setOffset((o) => Math.min(maxOffset, o + 1));
      else if (input === "G") setOffset(0);
      else if (input === "g") setOffset(maxOffset);
      else if (key.ctrl && input === "d") setOffset((o) => Math.max(0, o - half));
      else if (key.ctrl && input === "u") setOffset((o) => Math.min(maxOffset, o + half));
      else if (input === "/") setSearch({ active: true, query: "" });
      else if (input === "n") jump(1);
      else if (input === "N") jump(-1);
    },
    { isActive: !paletteOpen && !manager.active?.pendingPermission }
  );

  const start = Math.max(0, lines.length - height - effOffset);
  const visible = lines.slice(start, start + height);
  const q = search.query.toLowerCase();
  const searchRow = search.active || search.query !== "";
  const scrolledRow = overflow && effOffset > 0;
  const extraRows = (searchRow ? 1 : 0) + (scrolledRow ? 1 : 0);

  // Scrollbar thumb geometry (drawn only when the transcript overflows). The thumb
  // length is proportional to how much of the transcript is on screen; its position
  // tracks how far from the top the viewport currently sits.
  const thumbSize = overflow
    ? Math.min(height, Math.max(1, Math.round((height * height) / lines.length)))
    : 0;
  const thumbTrack = Math.max(0, height - thumbSize);
  const posFrac = maxOffset > 0 ? start / maxOffset : 0; // 0 = top … 1 = bottom
  const thumbStart = Math.min(thumbTrack, Math.round(posFrac * thumbTrack));

  return (
    <Box flexDirection="column" width={width} height={height + extraRows}>
      <Box flexDirection="row">
        <Box flexDirection="column" width={contentWidth}>
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
        </Box>
        {overflow && (
          <Box flexDirection="column" width={1}>
            {Array.from({ length: visible.length }, (_, r) => {
              const onThumb = r >= thumbStart && r < thumbStart + thumbSize;
              return (
                <Text key={r} color={onThumb ? theme.accent : theme.dim}>
                  {onThumb ? "█" : "│"}
                </Text>
              );
            })}
          </Box>
        )}
      </Box>
      {scrolledRow && (
        <Text color={theme.accent}>
          ↓ {effOffset} more line{effOffset === 1 ? "" : "s"} below · PgDn / G to latest
        </Text>
      )}
      {searchRow && (
        <Text color={theme.accent}>/{search.query}{search.active ? "▋" : `  (n/N to jump)`}</Text>
      )}
    </Box>
  );
}
