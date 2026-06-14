import type { Line, Span } from "./wrap-spans.js";

/** SGR mouse report, e.g. "[<32;10;5M" (Ink strips the leading ESC). Terminals can batch
 *  several into one input chunk, so this is a non-anchored test. */
const MOUSE_SEQ = /\[<\d+;\d+;\d+[Mm]/;

/** True if `input` contains any SGR mouse report — text inputs must IGNORE these (so mouse
 *  motion never leaks into the composer / a picker query); only ChatPane consumes them. */
export function isMouseSequence(input: string | undefined): boolean {
  return !!input && MOUSE_SEQ.test(input);
}

/** A cell in the visible chat grid: row = index into the on-screen lines, col = char column. */
export interface Cell {
  row: number;
  col: number;
}

/** An in-progress / finished selection: from `anchor` (mouse-down) to `head` (drag). */
export interface Range {
  anchor: Cell;
  head: Cell;
}

/** Normalize a range so start ≤ end in (row, then col) order. */
export function ordered(r: Range): { start: Cell; end: Cell } {
  const { anchor, head } = r;
  const anchorFirst = anchor.row < head.row || (anchor.row === head.row && anchor.col <= head.col);
  return anchorFirst ? { start: anchor, end: head } : { start: head, end: anchor };
}

/** The selected [from, to) column span on visible `row` (clamped to lineLen), or null if the
 *  row is outside the selection or the span is empty. */
export function rowSpan(r: Range, row: number, lineLen: number): { from: number; to: number } | null {
  const { start, end } = ordered(r);
  if (row < start.row || row > end.row) return null;
  const from = Math.max(0, row === start.row ? start.col : 0);
  const to = Math.min(lineLen, row === end.row ? end.col : lineLen);
  return to > from ? { from, to } : null;
}

/** Plain text of a line (concatenated span text). */
export function lineChars(line: Line): string {
  return line.spans.map((s) => s.text).join("");
}

/** Split a line's spans so the characters in [from, to) carry the selection background. */
export function applySelectionBg(line: Line, from: number, to: number, bg: string): Line {
  const out: Span[] = [];
  let col = 0;
  for (const s of line.spans) {
    const segStart = col;
    const segEnd = col + s.text.length;
    if (segEnd <= from || segStart >= to) {
      out.push(s); // wholly outside the selection
    } else {
      const a = Math.max(from, segStart);
      const b = Math.min(to, segEnd);
      if (a > segStart) out.push({ ...s, text: s.text.slice(0, a - segStart) });
      out.push({ ...s, text: s.text.slice(a - segStart, b - segStart), bg });
      if (b < segEnd) out.push({ ...s, text: s.text.slice(b - segStart) });
    }
    col = segEnd;
  }
  return { spans: out };
}

/** The selected text across the visible lines, newline-joined (for clipboard copy). */
export function selectionText(visible: readonly Line[], r: Range): string {
  const { start, end } = ordered(r);
  const parts: string[] = [];
  for (let row = start.row; row <= end.row; row++) {
    const line = visible[row];
    if (!line) continue;
    const text = lineChars(line);
    const span = rowSpan(r, row, text.length);
    parts.push(span ? text.slice(span.from, span.to) : "");
  }
  return parts.join("\n");
}
