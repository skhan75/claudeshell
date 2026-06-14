/**
 * Headless single-line editor model — pure functions over `{ text, cursor }`, so the
 * composer's editing behavior (word/line delete, cursor motion) is unit-testable with no
 * Ink. The InputBar holds the state and maps keys to these; `windowText` handles the
 * horizontal scroll so the cursor stays visible on a fixed-width line.
 */
export interface LineState {
  text: string;
  /** Caret index in [0, text.length]. The caret sits *before* text[cursor]. */
  cursor: number;
}

const isWord = (c: string | undefined): boolean => c !== undefined && /\S/.test(c);
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Start of the word at/just left of `cursor` (skips trailing spaces, then the word). */
function wordStart(text: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && !isWord(text[i - 1])) i--;
  while (i > 0 && isWord(text[i - 1])) i--;
  return i;
}

/** End of the word at/just right of `cursor` (skips leading spaces, then the word). */
function wordEnd(text: string, cursor: number): number {
  let i = cursor;
  while (i < text.length && !isWord(text[i])) i++;
  while (i < text.length && isWord(text[i])) i++;
  return i;
}

export function insert(s: LineState, ch: string): LineState {
  return { text: s.text.slice(0, s.cursor) + ch + s.text.slice(s.cursor), cursor: s.cursor + ch.length };
}

/** Delete the character before the caret (Backspace). */
export function backspace(s: LineState): LineState {
  if (s.cursor <= 0) return s;
  return { text: s.text.slice(0, s.cursor - 1) + s.text.slice(s.cursor), cursor: s.cursor - 1 };
}

/** Delete the character at the caret (forward delete / Ctrl+D). */
export function del(s: LineState): LineState {
  if (s.cursor >= s.text.length) return s;
  return { text: s.text.slice(0, s.cursor) + s.text.slice(s.cursor + 1), cursor: s.cursor };
}

/** Delete the word before the caret (Ctrl+W / Option+Backspace). Leaves a separating space, like bash. */
export function deleteWordLeft(s: LineState): LineState {
  if (s.cursor <= 0) return s;
  const start = wordStart(s.text, s.cursor);
  return { text: s.text.slice(0, start) + s.text.slice(s.cursor), cursor: start };
}

/** Delete the word at/after the caret (Option+Delete forward). */
export function deleteWordRight(s: LineState): LineState {
  if (s.cursor >= s.text.length) return s;
  const end = wordEnd(s.text, s.cursor);
  return { text: s.text.slice(0, s.cursor) + s.text.slice(end), cursor: s.cursor };
}

/** Delete from the caret to the start of the line (Ctrl+U). */
export function deleteToStart(s: LineState): LineState {
  return { text: s.text.slice(s.cursor), cursor: 0 };
}

/** Delete from the caret to the end of the line (Ctrl+K). */
export function deleteToEnd(s: LineState): LineState {
  return { text: s.text.slice(0, s.cursor), cursor: s.cursor };
}

export const moveLeft = (s: LineState): LineState => ({ ...s, cursor: clamp(s.cursor - 1, 0, s.text.length) });
export const moveRight = (s: LineState): LineState => ({ ...s, cursor: clamp(s.cursor + 1, 0, s.text.length) });
export const moveWordLeft = (s: LineState): LineState => ({ ...s, cursor: wordStart(s.text, s.cursor) });
export const moveWordRight = (s: LineState): LineState => ({ ...s, cursor: wordEnd(s.text, s.cursor) });
export const moveHome = (s: LineState): LineState => ({ ...s, cursor: 0 });
export const moveEnd = (s: LineState): LineState => ({ ...s, cursor: s.text.length });

/**
 * The visible horizontal window of a single-line input. Returns the substring that fits
 * in `width` columns plus the caret's column within it — the window follows the caret
 * (tail when at/near the end, centered when editing mid-line) so the caret is always shown.
 * `caret === slice.length` means the caret is just past the last visible char (end-of-line).
 */
export function windowText(text: string, cursor: number, width: number): { slice: string; caret: number } {
  if (width <= 0) return { slice: "", caret: 0 };
  const cur = clamp(cursor, 0, text.length);
  if (text.length <= width) return { slice: text, caret: cur };
  let start: number;
  if (cur >= text.length - 1) {
    start = text.length - width; // at/near the end → show the tail
  } else {
    start = clamp(cur - Math.floor(width / 2), 0, text.length - width); // else center the caret
  }
  return { slice: text.slice(start, start + width), caret: cur - start };
}
