import { marked } from "marked";
import { theme } from "./theme.js";
import { wrapSpans, lineText, type Span, type Line } from "./wrap-spans.js";

/**
 * Markdown → styled terminal lines for the chat pane.
 *
 * We reuse marked's lexer (the standard parser — we never hand-roll markdown
 * parsing) and map its tokens to themed {@link Span}s, then word-wrap to width
 * via {@link wrapSpans}. The renderer emits CONTENT lines only — no role header
 * and no left `│ ` rule (ChatPane prepends those). Output is pure data so it is
 * unit-testable without Ink.
 */

marked.setOptions({ gfm: true, breaks: false });

// Subtle backgrounds that read as distinct surfaces over the app's INK_BG (#0b0e14).
const CODESPAN_BG = "#16202e"; // inline `code` chip
const CODE_BG = "#10151f"; // fenced code panel
const CODE_FG = "#aeb9d4"; // code text — cooler/quieter than prose fg

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tok = any;
type Style = Omit<Span, "text">;

const BLANK: Line = { spans: [] };

/** Decode the small fixed set of entities marked leaves encoded in text tokens. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Merge a child style onto the accumulator: flags OR in, color/bg overwrite (innermost wins). */
function merge(acc: Style, add: Partial<Style>): Style {
  return {
    color: add.color ?? acc.color,
    bg: add.bg ?? acc.bg,
    bold: acc.bold || add.bold,
    italic: acc.italic || add.italic,
    underline: acc.underline || add.underline,
    strikethrough: acc.strikethrough || add.strikethrough,
    dim: acc.dim || add.dim,
  };
}

function styled(text: string, st: Style): Span {
  return { text, ...st };
}

/** Recursively render inline tokens into a flat span list under a style accumulator. */
function inline(tokens: Tok[], acc: Style, out: Span[]): void {
  for (const tk of tokens ?? []) {
    switch (tk.type) {
      case "text":
        if (tk.tokens && tk.tokens.length) inline(tk.tokens, acc, out);
        else out.push(styled(decodeEntities(tk.text ?? ""), acc));
        break;
      case "escape":
        out.push(styled(tk.text ?? "", acc));
        break;
      case "strong":
        inline(tk.tokens, merge(acc, { bold: true }), out);
        break;
      case "em":
        inline(tk.tokens, merge(acc, { italic: true }), out);
        break;
      case "del":
        inline(tk.tokens, merge(acc, { strikethrough: true }), out);
        break;
      case "codespan":
        out.push(styled(decodeEntities(tk.text ?? ""), merge(acc, { color: theme.accent, bg: CODESPAN_BG })));
        break;
      case "link": {
        const linkAcc = merge(acc, { color: theme.accent, underline: true });
        const before = out.length;
        if (tk.tokens && tk.tokens.length) inline(tk.tokens, linkAcc, out);
        else if (tk.text) out.push(styled(decodeEntities(tk.text), linkAcc));
        const shown = out.slice(before).map((s) => s.text).join("");
        const href = tk.href ?? "";
        const disp = href.length > 50 ? href.slice(0, 47) + "…" : href;
        if (shown === "" && href) {
          // Empty link text → render the href itself as the (underlined) link,
          // so it never collapses to an invisible span + bare parenthetical.
          out.push(styled(disp, linkAcc));
        } else if (href && decodeEntities(href) !== shown) {
          // Compare in decoded form so entity-encoded autolinks aren't duplicated.
          out.push(styled(` (${disp})`, { color: theme.dim, dim: true }));
        }
        break;
      }
      case "image":
        out.push(styled(`[img: ${tk.text || tk.href || ""}]`, merge(acc, { color: theme.dim, dim: true })));
        break;
      case "br":
        out.push({ text: "\n" }); // forced line break — wrapSpans treats \n as a hard break
        break;
      case "html":
        out.push(styled(tk.text ?? "", merge(acc, { color: theme.dim, dim: true })));
        break;
      default:
        if (typeof tk.text === "string") out.push(styled(decodeEntities(tk.text), acc));
        else if (tk.tokens) inline(tk.tokens, acc, out);
    }
  }
}

function inlineSpans(tokens: Tok[], base: Style): Span[] {
  const out: Span[] = [];
  inline(tokens, base, out);
  return out;
}

/** Prepend a marker to line 0 and an equal-width dim indent to continuation lines. */
function withMarker(lines: Line[], marker: Span): Line[] {
  const indent = " ".repeat([...marker.text].length);
  return lines.map((l, i) =>
    i === 0
      ? { spans: [marker, ...l.spans] }
      : { spans: [{ text: indent, dim: true }, ...l.spans] }
  );
}

const HEAD_STYLE: Record<number, Style> = {
  1: { color: theme.accent, bold: true },
  2: { color: theme.accent, bold: true },
  3: { color: theme.purple, bold: true },
  4: { color: theme.fg, bold: true },
  5: { color: theme.fg, bold: true },
  6: { color: theme.dim, bold: true },
};
const HEAD_PREFIX: Record<number, [string, string]> = {
  1: ["▎ ", theme.accent],
  2: ["▌ ", theme.accent],
  3: ["◆ ", theme.purple],
  4: ["▸ ", theme.dim],
  5: ["· ", theme.dim],
  6: ["", theme.dim],
};

function renderHeading(tk: Tok, width: number): Line[] {
  const d = Math.min(6, Math.max(1, tk.depth ?? 1));
  let spans = inlineSpans(tk.tokens, HEAD_STYLE[d]);
  if (d === 1) spans = spans.map((s) => ({ ...s, text: s.text.toUpperCase() }));
  const [prefix, pColor] = HEAD_PREFIX[d];
  const pLen = [...prefix].length;
  const wrapped = wrapSpans(spans, Math.max(1, width - pLen));
  const lines = prefix
    ? withMarker(wrapped, { text: prefix, color: pColor, bold: true })
    : wrapped;
  if (d === 1) {
    // Underline matches the widest RENDERED title line (incl. prefix), not the
    // pre-wrap text length, so a wrapped h1 stays aligned.
    const widths = lines.map((l) => l.spans.reduce((n, s) => n + [...s.text].length, 0));
    const titleW = Math.min(width, Math.max(1, ...widths));
    lines.push({ spans: [{ text: "─".repeat(titleW), color: theme.accent }] });
  }
  return lines;
}

const BULLETS = ["•", "◦", "▪", "·"];

function renderList(tk: Tok, width: number, depth: number): Line[] {
  const lines: Line[] = [];
  const items: Tok[] = tk.items ?? [];
  const ordered: boolean = !!tk.ordered;
  const start: number = Number.isFinite(tk.start) ? tk.start : 1;
  // Width of the widest marker, for ordered right-alignment ("9." vs "10.").
  const lastNum = start + items.length - 1;
  const numW = String(lastNum).length + 1; // digits + "."
  items.forEach((item, idx) => {
    if (tk.loose && idx > 0) lines.push(BLANK);
    let marker: Span;
    if (item.task) {
      marker = item.checked
        ? { text: "[x] ", color: theme.good, bold: true }
        : { text: "[ ] ", color: theme.dim };
    } else if (ordered) {
      const label = `${start + idx}.`.padStart(numW, " ") + " ";
      marker = { text: label, color: theme.purple };
    } else {
      marker = { text: BULLETS[Math.min(depth, BULLETS.length - 1)] + " ", color: theme.purple };
    }
    const mLen = [...marker.text].length;
    const itemTokens: Tok[] = item.tokens ?? [];
    const nested = itemTokens.filter((t) => t.type === "list");
    const own = itemTokens.filter((t) => t.type !== "list");
    // Render the item's own (non-list) content, marker on the first line.
    const contentSpans: Span[] = [];
    for (const t of own) {
      const toks = t.tokens ?? (typeof t.text === "string" ? [{ type: "text", text: t.text }] : []);
      if (contentSpans.length) contentSpans.push({ text: "\n" });
      inline(toks, { color: theme.fg }, contentSpans);
    }
    const wrapped = wrapSpans(contentSpans, Math.max(1, width - mLen));
    lines.push(...withMarker(wrapped, marker));
    // Nested lists: indent by 2 and recurse.
    for (const sub of nested) {
      const subLines = renderList(sub, Math.max(1, width - 2), depth + 1);
      for (const sl of subLines) lines.push({ spans: [{ text: "  ", dim: true }, ...sl.spans] });
    }
  });
  return lines;
}

function renderCode(tk: Tok, width: number): Line[] {
  const lang = (tk.lang ?? "").trim().toLowerCase();
  const diffMode = lang === "diff" || lang === "patch";
  const lines: Line[] = [];
  // Header: a left rule + the language label.
  lines.push({
    spans: [
      { text: "▐ ", color: theme.accent },
      { text: lang || "code", color: lang ? theme.good : theme.dim },
    ],
  });
  const bodyW = Math.max(1, width - 2); // rule occupies 2 cols
  const raw = String(tk.text ?? "").replace(/\n$/, "");
  for (const srcLine of raw.split("\n")) {
    let codeColor = CODE_FG;
    if (diffMode) {
      const c = srcLine[0];
      if (c === "+") codeColor = theme.good;
      else if (c === "-") codeColor = theme.bad;
      else if (c === "@") codeColor = theme.purple;
    }
    // Hard char-wrap (preserve alignment); pad each slice so the bg fills the panel.
    let rest = srcLine.length === 0 ? [""] : [];
    if (srcLine.length > 0) {
      for (let i = 0; i < srcLine.length; i += bodyW) rest.push(srcLine.slice(i, i + bodyW));
    }
    rest.forEach((slice, i) => {
      const padded = slice + " ".repeat(Math.max(0, bodyW - [...slice].length));
      lines.push({
        spans: [
          { text: "▌ ", color: i === 0 ? theme.accent : theme.dim },
          { text: padded, color: codeColor, bg: CODE_BG },
        ],
      });
    });
  }
  return lines;
}

function renderQuote(tk: Tok, width: number): Line[] {
  const inner = renderTokens(tk.tokens, Math.max(1, width - 2));
  return inner.map((l) => ({
    spans: [
      { text: "▏ ", color: theme.dim },
      // Force dim+italic only on default-fg spans; keep code/link/emphasis colors.
      ...l.spans.map((s) =>
        s.color === undefined || s.color === theme.fg ? { ...s, color: theme.dim, dim: true, italic: true } : s
      ),
    ],
  }));
}

function stripStyle(spans: Span[]): string {
  return spans.map((s) => s.text).join("");
}

function renderTable(tk: Tok, width: number): Line[] {
  const header: Tok[] = tk.header ?? [];
  const rows: Tok[][] = tk.rows ?? [];
  const align: (string | null)[] = tk.align ?? [];
  const ncols = header.length;
  if (ncols === 0) return [];
  const headText = header.map((c) => stripStyle(inlineSpans(c.tokens, {})));
  const cellText = rows.map((r) => r.map((c) => stripStyle(inlineSpans(c.tokens, {}))));
  // Natural column widths.
  const natural = headText.map((h, i) =>
    Math.max([...h].length, ...cellText.map((r) => [...(r[i] ?? "")].length), 1)
  );
  const sep = 3; // " │ "
  let colW = natural.slice();
  const total = () => colW.reduce((a, b) => a + b, 0) + sep * (ncols - 1);
  // Shrink widest columns until it fits, floor 6.
  let guard = 0;
  while (total() > width && guard++ < 500) {
    const max = Math.max(...colW);
    const idx = colW.indexOf(max);
    if (max <= 6) break;
    colW[idx] = max - 1;
  }
  // Fallback: definition list when still too wide or too many columns.
  if (ncols > 6 || total() > width) {
    const lines: Line[] = [];
    cellText.forEach((row, ri) => {
      if (ri > 0) lines.push(BLANK);
      lines.push(...wrapSpans([{ text: row[0] ?? "", color: theme.accent, bold: true }], width));
      for (let i = 1; i < ncols; i++) {
        lines.push(
          ...wrapSpans(
            [
              { text: `    ${headText[i]}: `, color: theme.dim, dim: true },
              { text: row[i] ?? "", color: theme.fg },
            ],
            width
          )
        );
      }
    });
    return lines;
  }
  const pad = (text: string, w: number, a: string | null): string => {
    const len = [...text].length;
    let t = text;
    if (len > w) t = [...text].slice(0, Math.max(0, w - 1)).join("") + "…";
    const gap = Math.max(0, w - [...t].length);
    if (a === "right") return " ".repeat(gap) + t;
    if (a === "center") {
      const l = Math.floor(gap / 2);
      return " ".repeat(l) + t + " ".repeat(gap - l);
    }
    return t + " ".repeat(gap);
  };
  const sepSpan = (): Span => ({ text: " │ ", color: theme.dim });
  const rowLine = (cells: string[], st: Style): Line => {
    const spans: Span[] = [];
    cells.forEach((c, i) => {
      if (i > 0) spans.push(sepSpan());
      spans.push({ text: pad(c, colW[i], align[i] ?? null), ...st });
    });
    return { spans };
  };
  const lines: Line[] = [];
  lines.push(rowLine(headText, { color: theme.accent, bold: true }));
  lines.push({ spans: [{ text: colW.map((w) => "─".repeat(w)).join("─┼─"), color: theme.dim }] });
  for (const r of cellText) lines.push(rowLine(r.map((c) => c ?? ""), { color: theme.fg }));
  return lines;
}

function renderBlock(tk: Tok, width: number, depth: number): Line[] {
  switch (tk.type) {
    case "heading":
      return renderHeading(tk, width);
    case "paragraph":
      return wrapSpans(inlineSpans(tk.tokens, { color: theme.fg }), width);
    case "text":
      return wrapSpans(
        inlineSpans(tk.tokens ?? [{ type: "text", text: tk.text }], { color: theme.fg }),
        width
      );
    case "list":
      return renderList(tk, width, depth);
    case "code":
      return renderCode(tk, width);
    case "blockquote":
      return renderQuote(tk, width);
    case "hr":
      return [{ spans: [{ text: "─".repeat(Math.max(1, width)), color: theme.dim }] }];
    case "table":
      return renderTable(tk, width);
    case "html":
      return wrapSpans([{ text: String(tk.text ?? "").replace(/\n+$/, ""), color: theme.dim, dim: true }], width);
    default:
      return [];
  }
}

/** Render a token array to lines, inserting a single blank line between blocks. */
function renderTokens(tokens: Tok[], width: number, depth = 0): Line[] {
  const lines: Line[] = [];
  for (const tk of tokens ?? []) {
    if (tk.type === "space") continue;
    const block = renderBlock(tk, width, depth);
    if (block.length === 0) continue;
    if (lines.length > 0) lines.push(BLANK);
    for (const l of block) lines.push(l);
  }
  return lines;
}

/** Append a synthetic closing fence when an odd number of fences is open (streaming). */
function balanceFences(src: string): string {
  // CommonMark: a fence may be indented 0-3 spaces (4+ = indented code, not a fence).
  const fenceRe = /^ {0,3}(`{3,}|~{3,})/;
  let count = 0;
  let lastChar = "`";
  for (const line of src.split("\n")) {
    const m = fenceRe.exec(line);
    if (m) {
      count++;
      lastChar = m[1][0]; // close with the SAME fence char that was opened (` or ~)
    }
  }
  return count % 2 === 1 ? src + "\n" + lastChar.repeat(3) : src;
}

/**
 * Render markdown source to styled content lines, wrapped to `width`.
 * Total (never throws): on any internal error, falls back to plain wrapped text.
 */
export function renderMarkdown(src: string, width: number): Line[] {
  try {
    const prepared = balanceFences(src.replace(/\n$/, ""));
    const tokens = marked.lexer(prepared) as Tok[];
    const lines = renderTokens(tokens, Math.max(1, width));
    return lines.length ? lines : [BLANK];
  } catch {
    // Degrade gracefully — never crash the stream.
    const out: Line[] = [];
    for (const raw of src.split("\n")) out.push(...wrapSpans([{ text: raw, color: theme.fg }], Math.max(1, width)));
    return out.length ? out : [BLANK];
  }
}

export { lineText, type Span, type Line };
