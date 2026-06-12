import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import type { TranscriptBlock } from "../core/types.js";

export interface Line {
  text: string;
  color?: string;
  dim?: boolean;
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
  switch (b.kind) {
    case "user":
      return wrapText("❯ " + b.text, width).map((t) => ({ text: t, color: theme.warn }));
    case "assistant":
      return wrapText(b.text + (b.streaming ? "▋" : ""), width).map((t) => ({
        text: t,
        color: t.startsWith("+") ? theme.good : t.startsWith("-") ? theme.bad : undefined,
      }));
    case "tool":
      return [{
        text: `⚙ ${b.name} ${b.detail} ${b.status === "running" ? "…" : "✓"}`.slice(0, width),
        color: theme.purple,
      }];
    case "info":
      return wrapText(b.text, width).map((t) => ({ text: t, dim: true }));
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
  const height = heightProp ?? Math.max(6, (stdout?.rows ?? 24) - 8);

  const [offset, setOffset] = useState(0); // lines scrolled up from bottom
  const [search, setSearch] = useState({ active: false, query: "" });

  useEffect(() => {
    setOffset(0);
    setSearch({ active: false, query: "" });
  }, [session?.id]);

  // PERF(v1.1): rebuilt on every render; during streaming this re-wraps the whole
  // transcript per delta. Fine for short sessions — memoize prefix wrapping (all
  // blocks except the streaming tail) before long-session support.
  const lines: Line[] = [];
  for (const b of session?.transcript.blocks ?? []) lines.push(...blockLines(b, width));
  const maxOffset = Math.max(0, lines.length - height);

  const jump = (dir: 1 | -1) => {
    const q = search.query.toLowerCase();
    if (!q) return;
    const matches = lines
      .map((l, i) => (l.text.toLowerCase().includes(q) ? i : -1))
      .filter((i) => i >= 0);
    if (matches.length === 0) return;
    const cur = Math.max(0, lines.length - height - offset);
    const next =
      dir === 1
        ? matches.find((i) => i > cur) ?? matches[0]
        : [...matches].reverse().find((i) => i < cur) ?? matches[matches.length - 1];
    setOffset(Math.max(0, Math.min(maxOffset, lines.length - height - next)));
  };

  useInput(
    (input, key) => {
      if (search.active) {
        if (key.escape) setSearch({ active: false, query: "" });
        else if (key.return) setSearch((s) => ({ ...s, active: false }));
        else if (key.backspace || key.delete) setSearch((s) => ({ ...s, query: s.query.slice(0, -1) }));
        else if (input && !key.ctrl && !key.meta) setSearch((s) => ({ ...s, query: s.query + input }));
        return;
      }
      if (key.escape && search.query !== "") {
        setSearch({ active: false, query: "" });
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
