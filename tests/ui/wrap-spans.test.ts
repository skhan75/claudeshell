import { describe, it, expect } from "vitest";
import {
  wrapSpans,
  lineText,
  spanLen,
  type Span,
  type Line,
} from "../../src/ui/wrap-spans.js";

// ---- helpers -------------------------------------------------------------

/** Plain unstyled span. */
const t = (text: string): Span => ({ text });

/** Concatenated text of every produced line. */
const texts = (lines: Line[]): string[] => lines.map(lineText);

/** Assert no produced line — including any indent — exceeds `width`. */
function expectWithin(lines: Line[], width: number): void {
  for (const l of lines) {
    expect(lineText(l).length).toBeLessThanOrEqual(width);
  }
}

/** All non-text style props of a span, for equality checks. */
function styleOf(s: Span): Omit<Span, "text"> {
  const { text, ...rest } = s;
  return rest;
}

// ---- spanLen / lineText --------------------------------------------------

describe("spanLen / lineText", () => {
  it("spanLen sums text lengths", () => {
    expect(spanLen([])).toBe(0);
    expect(spanLen([t("ab"), t(""), t("cde")])).toBe(5);
  });

  it("lineText concatenates span text", () => {
    expect(lineText({ spans: [t("foo"), t(" "), t("bar")] })).toBe("foo bar");
    expect(lineText({ spans: [] })).toBe("");
  });
});

// ---- single plain span ---------------------------------------------------

describe("single plain span", () => {
  it("wraps at spaces and drops the breaking space", () => {
    const lines = wrapSpans([t("the quick brown fox")], 10);
    expect(texts(lines)).toEqual(["the quick", "brown fox"]);
    expectWithin(lines, 10);
  });

  it("matches plain wrapText fallback for width 0 (hello -> chars)", () => {
    const lines = wrapSpans([t("hello")], 0);
    expect(texts(lines)).toEqual(["h", "e", "l", "l", "o"]);
    expectWithin(lines, 1);
  });

  it("leaves text shorter than width untouched", () => {
    const lines = wrapSpans([t("hi")], 10);
    expect(texts(lines)).toEqual(["hi"]);
    expect(lines).toHaveLength(1);
  });
});

// ---- multi-span: wrap mid-second-span, styles preserved on BOTH lines ----

describe("multi-span wrap mid second span", () => {
  it("preserves each span's style across the break", () => {
    const red: Span = { text: "hello ", color: "red", bold: true };
    // "world wide" lives in one bold-green span; wrap should fall inside it.
    const green: Span = { text: "world wide", color: "green", bold: true };
    const lines = wrapSpans([red, green], 9);

    // "hello world" is 11 > 9, soft-break at the space after "world".
    expect(texts(lines)).toEqual(["hello", "world", "wide"]);
    expectWithin(lines, 9);

    // Line 0: only the red span's text survives ("hello", trailing space eaten).
    expect(lines[0].spans.map((s) => s.text)).toEqual(["hello"]);
    expect(styleOf(lines[0].spans[0])).toEqual({
      color: "red",
      bold: true,
      italic: undefined,
      underline: undefined,
      strikethrough: undefined,
      dim: undefined,
      bg: undefined,
    });

    // Line 1 ("world") and line 2 ("wide") come from the green span — its style
    // must be intact on BOTH resulting lines.
    expect(styleOf(lines[1].spans[0])).toMatchObject({ color: "green", bold: true });
    expect(styleOf(lines[2].spans[0])).toMatchObject({ color: "green", bold: true });
    expect(lines[1].spans[0].text).toBe("world");
    expect(lines[2].spans[0].text).toBe("wide");
  });

  it("keeps two differently-styled spans on the same line as distinct spans", () => {
    const a: Span = { text: "foo", color: "red" };
    const b: Span = { text: "bar", color: "blue" };
    const lines = wrapSpans([a, b], 80);
    expect(lines).toHaveLength(1);
    expect(lines[0].spans).toHaveLength(2);
    expect(lines[0].spans[0]).toMatchObject({ text: "foo", color: "red" });
    expect(lines[0].spans[1]).toMatchObject({ text: "bar", color: "blue" });
  });

  it("merges adjacent same-style fragments back into one span", () => {
    // Same style split across two source spans should re-merge per line.
    const a: Span = { text: "foo", color: "red" };
    const b: Span = { text: "bar", color: "red" };
    const lines = wrapSpans([a, b], 80);
    expect(lines[0].spans).toHaveLength(1);
    expect(lines[0].spans[0]).toMatchObject({ text: "foobar", color: "red" });
  });
});

// ---- word longer than width: hard split ----------------------------------

describe("word longer than width (hard split)", () => {
  it("hard-splits a single long word, dropping nothing", () => {
    const lines = wrapSpans([t("abcdefghij")], 4);
    expect(texts(lines)).toEqual(["abcd", "efgh", "ij"]);
    expectWithin(lines, 4);
    // Nothing dropped: reassembly equals the original.
    expect(texts(lines).join("")).toBe("abcdefghij");
  });

  it("hard-splits a long word preserving its style on every fragment", () => {
    const word: Span = { text: "supercalifragilistic", color: "cyan", italic: true };
    const lines = wrapSpans([word], 6);
    expectWithin(lines, 6);
    for (const l of lines) {
      expect(l.spans).toHaveLength(1);
      expect(styleOf(l.spans[0])).toMatchObject({ color: "cyan", italic: true });
    }
    expect(texts(lines).join("")).toBe("supercalifragilistic");
  });

  it("hard-splits then soft-wraps the remainder", () => {
    // "loooong" (7) > 5 hard-splits; then " word" soft-wraps.
    const lines = wrapSpans([t("loooong word")], 5);
    expect(texts(lines)).toEqual(["loooo", "ng", "word"]);
    expectWithin(lines, 5);
  });
});

// ---- embedded newline ----------------------------------------------------

describe("embedded newline", () => {
  it("forces a new line on \\n inside a span", () => {
    const lines = wrapSpans([t("a\nb")], 80);
    expect(texts(lines)).toEqual(["a", "b"]);
  });

  it("a newline that splits a single styled span keeps the style on both", () => {
    const s: Span = { text: "one\ntwo", color: "magenta" };
    const lines = wrapSpans([s], 80);
    expect(texts(lines)).toEqual(["one", "two"]);
    expect(styleOf(lines[0].spans[0])).toMatchObject({ color: "magenta" });
    expect(styleOf(lines[1].spans[0])).toMatchObject({ color: "magenta" });
  });

  it("preserves blank lines from consecutive newlines", () => {
    const lines = wrapSpans([t("a\n\nb")], 80);
    expect(texts(lines)).toEqual(["a", "", "b"]);
  });

  it("wraps within a logical line independently of others", () => {
    const lines = wrapSpans([t("hello world\nbye")], 5);
    expect(texts(lines)).toEqual(["hello", "world", "bye"]);
    expectWithin(lines, 5);
  });
});

// ---- spaces: leading / trailing / multiple -------------------------------

describe("space handling", () => {
  it("keeps leading spaces as content", () => {
    const lines = wrapSpans([t("  hi")], 80);
    expect(texts(lines)).toEqual(["  hi"]);
  });

  it("keeps trailing spaces when no wrap is needed", () => {
    const lines = wrapSpans([t("hi  ")], 80);
    expect(texts(lines)).toEqual(["hi  "]);
  });

  it("consumes exactly one breaking space at a greedy soft wrap; extras remain", () => {
    // "a  b" with width 2: greedy wrap breaks at the LAST in-reach space
    // (index 2), packing "a " onto line 1 and consuming that space, leaving "b".
    const lines = wrapSpans([t("a  b")], 2);
    expect(texts(lines)).toEqual(["a ", "b"]);
    expectWithin(lines, 2);
    // Exactly one character (the single breaking space) is consumed.
    expect(texts(lines).join("").length).toBe("a  b".length - 1);
  });

  it("the leading space survives when it is not the chosen break point", () => {
    // "x  yy" width 3: greedy break at the last in-reach space (index 2),
    // emitting "x " then "yy"; with a tighter width the extra space rides along.
    const lines = wrapSpans([t("x  yy")], 4);
    expect(texts(lines)).toEqual(["x ", "yy"]);
    expectWithin(lines, 4);
  });

  it("a line that is all spaces and fits is preserved verbatim", () => {
    const lines = wrapSpans([t("   ")], 10);
    expect(texts(lines)).toEqual(["   "]);
  });
});

// ---- width 0 and negative ------------------------------------------------

describe("width <= 0 behaves like width 1 and never hangs", () => {
  it("width 0 splits into single characters", () => {
    const lines = wrapSpans([t("abc")], 0);
    expect(texts(lines)).toEqual(["a", "b", "c"]);
    expectWithin(lines, 1);
  });

  it("negative width splits into single characters", () => {
    const lines = wrapSpans([t("abc")], -5);
    expect(texts(lines)).toEqual(["a", "b", "c"]);
    expectWithin(lines, 1);
  });

  it("width 0 with spaces does not infinite-loop and drops breaking spaces", () => {
    const lines = wrapSpans([t("a b c")], 0);
    expect(texts(lines)).toEqual(["a", "b", "c"]);
    expectWithin(lines, 1);
  });
});

// ---- hangingIndent continuation ------------------------------------------

describe("hangingIndent", () => {
  it("indents continuation lines only, not the first", () => {
    const lines = wrapSpans([t("alpha beta gamma delta")], 10, {
      hangingIndent: "  ",
    });
    // First line uses full width 10; continuations get a 2-space dim prefix and
    // wrap to width-2 = 8.
    expect(texts(lines)).toEqual(["alpha beta", "  gamma", "  delta"]);
    expectWithin(lines, 10);

    // First line: no indent span.
    expect(lines[0].spans[0].text).toBe("alpha beta");
    expect(lines[0].spans[0].dim).toBeUndefined();

    // Continuation lines: a leading dim indent span.
    expect(lines[1].spans[0]).toMatchObject({ text: "  ", dim: true });
    expect(lines[1].spans[1].text).toBe("gamma");
    expect(lines[2].spans[0]).toMatchObject({ text: "  ", dim: true });
  });

  it("counts the indent against the width budget (no off-by-one)", () => {
    const lines = wrapSpans([t("xxxxxxxxxx yyyyyyyyyy")], 6, {
      hangingIndent: ">> ",
    });
    expectWithin(lines, 6);
    // Continuation content budget is 6 - 3 = 3.
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].spans[0]).toMatchObject({ text: ">> ", dim: true });
      const content = lines[i].spans.slice(1).map((s) => s.text).join("");
      expect(content.length).toBeLessThanOrEqual(3);
    }
  });

  it("does not hang when indent is wider than width", () => {
    const lines = wrapSpans([t("aaaaaaaa")], 3, { hangingIndent: "      " });
    // Continuation content budget clamps to >= 1 so progress is guaranteed.
    expect(lines.length).toBeGreaterThan(1);
    expect(texts(lines).join("").replace(/ /g, "")).toBe("aaaaaaaa");
  });
});

// ---- empty input ---------------------------------------------------------

describe("empty input", () => {
  it("empty span array yields a single empty line", () => {
    const lines = wrapSpans([], 80);
    expect(lines).toHaveLength(1);
    expect(texts(lines)).toEqual([""]);
  });

  it("a single empty-text span yields a single empty line", () => {
    const lines = wrapSpans([t("")], 80);
    expect(texts(lines)).toEqual([""]);
  });
});

// ---- length == width exactly ---------------------------------------------

describe("span length equals width exactly", () => {
  it("fits on one line with no wrap", () => {
    const lines = wrapSpans([{ text: "12345", color: "yellow" }], 5);
    expect(texts(lines)).toEqual(["12345"]);
    expect(lines).toHaveLength(1);
    expect(styleOf(lines[0].spans[0])).toMatchObject({ color: "yellow" });
    expectWithin(lines, 5);
  });

  it("width+1 forces exactly one break", () => {
    const lines = wrapSpans([t("123456")], 5);
    expect(texts(lines)).toEqual(["12345", "6"]);
    expectWithin(lines, 5);
  });

  it("a word exactly width long after a space wraps cleanly", () => {
    // "ab" + " " + "12345" : width 5. "ab 12345" is 8 > 5; soft-break at the
    // space leaves "12345" which is exactly width.
    const lines = wrapSpans([t("ab 12345")], 5);
    expect(texts(lines)).toEqual(["ab", "12345"]);
    expectWithin(lines, 5);
  });
});
