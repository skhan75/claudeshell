import { describe, it, expect } from "vitest";
import { ordered, rowSpan, applySelectionBg, selectionText, type Range } from "../../src/ui/selection.js";
import type { Line } from "../../src/ui/wrap-spans.js";

const line = (text: string): Line => ({ spans: [{ text }] });

describe("ordered", () => {
  it("swaps anchor/head so start ≤ end", () => {
    const r: Range = { anchor: { row: 2, col: 5 }, head: { row: 1, col: 0 } };
    expect(ordered(r)).toEqual({ start: { row: 1, col: 0 }, end: { row: 2, col: 5 } });
  });
});

describe("rowSpan", () => {
  it("first row from anchor col, middle rows full, last row to head col", () => {
    const r: Range = { anchor: { row: 1, col: 3 }, head: { row: 3, col: 4 } };
    expect(rowSpan(r, 0, 10)).toBeNull(); // above the selection
    expect(rowSpan(r, 1, 10)).toEqual({ from: 3, to: 10 }); // first row
    expect(rowSpan(r, 2, 8)).toEqual({ from: 0, to: 8 }); // middle (full)
    expect(rowSpan(r, 3, 10)).toEqual({ from: 0, to: 4 }); // last row
    expect(rowSpan(r, 4, 10)).toBeNull(); // below
  });
  it("single-row selection uses both cols; empty span → null", () => {
    expect(rowSpan({ anchor: { row: 0, col: 2 }, head: { row: 0, col: 6 } }, 0, 10)).toEqual({ from: 2, to: 6 });
    expect(rowSpan({ anchor: { row: 0, col: 3 }, head: { row: 0, col: 3 } }, 0, 10)).toBeNull();
  });
});

describe("applySelectionBg", () => {
  it("splits spans so [from,to) carries the bg, preserving the text + other styles", () => {
    const l: Line = { spans: [{ text: "hello", color: "x" }, { text: "world", color: "y" }] };
    const out = applySelectionBg(l, 3, 7, "#sel"); // select chars 3..6 → "lo" + "wo"
    expect(out.spans.map((s) => s.text).join("")).toBe("helloworld");
    expect(out.spans.filter((s) => s.bg === "#sel").map((s) => s.text).join("")).toBe("lowo");
    // unselected spans keep their original color and no bg
    const hel = out.spans.find((s) => s.text === "hel");
    expect(hel?.color).toBe("x");
    expect(hel?.bg).toBeUndefined();
  });
});

describe("selectionText", () => {
  it("joins the selected substrings across rows with newlines", () => {
    const visible = [line("first line"), line("second"), line("third line")];
    const r: Range = { anchor: { row: 0, col: 6 }, head: { row: 2, col: 5 } };
    expect(selectionText(visible, r)).toBe("line\nsecond\nthird");
  });
});
