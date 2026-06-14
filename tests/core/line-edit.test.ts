import { describe, it, expect } from "vitest";
import {
  insert, backspace, del, deleteWordLeft, deleteWordRight, deleteToStart, deleteToEnd,
  moveLeft, moveRight, moveWordLeft, moveWordRight, moveHome, moveEnd, windowText,
  type LineState,
} from "../../src/core/line-edit.js";

const S = (text: string, cursor = text.length): LineState => ({ text, cursor });

describe("insert / backspace / del", () => {
  it("inserts at the caret", () => {
    expect(insert(S("abc", 1), "X")).toEqual({ text: "aXbc", cursor: 2 });
  });
  it("backspace removes the char before the caret; no-op at start", () => {
    expect(backspace(S("abc", 2))).toEqual({ text: "ac", cursor: 1 });
    expect(backspace(S("abc", 0))).toEqual({ text: "abc", cursor: 0 });
  });
  it("del removes the char at the caret; no-op at end", () => {
    expect(del(S("abc", 1))).toEqual({ text: "ac", cursor: 1 });
    expect(del(S("abc", 3))).toEqual({ text: "abc", cursor: 3 });
  });
});

describe("word + line deletes", () => {
  it("deleteWordLeft removes the previous word, leaving the separating space (bash-style)", () => {
    expect(deleteWordLeft(S("hello world"))).toEqual({ text: "hello ", cursor: 6 });
    expect(deleteWordLeft(S("hello world ", 12))).toEqual({ text: "hello ", cursor: 6 });
    expect(deleteWordLeft(S("one", 0))).toEqual({ text: "one", cursor: 0 });
  });
  it("deleteWordRight removes the next word from the caret", () => {
    expect(deleteWordRight(S("hello world", 6))).toEqual({ text: "hello ", cursor: 6 });
    expect(deleteWordRight(S("hello world", 0))).toEqual({ text: " world", cursor: 0 });
  });
  it("deleteToStart / deleteToEnd cut around the caret", () => {
    expect(deleteToStart(S("abcdef", 3))).toEqual({ text: "def", cursor: 0 });
    expect(deleteToEnd(S("abcdef", 3))).toEqual({ text: "abc", cursor: 3 });
  });
});

describe("cursor motion", () => {
  it("char + clamped moves", () => {
    expect(moveLeft(S("abc", 1)).cursor).toBe(0);
    expect(moveLeft(S("abc", 0)).cursor).toBe(0);
    expect(moveRight(S("abc", 3)).cursor).toBe(3);
    expect(moveHome(S("abc")).cursor).toBe(0);
    expect(moveEnd(S("abc", 0)).cursor).toBe(3);
  });
  it("word moves jump over whitespace then the word", () => {
    expect(moveWordLeft(S("foo bar baz")).cursor).toBe(8); // start of "baz"
    expect(moveWordLeft(S("foo bar baz", 8)).cursor).toBe(4); // start of "bar"
    expect(moveWordRight(S("foo bar baz", 0)).cursor).toBe(3); // end of "foo"
    expect(moveWordRight(S("foo bar baz", 3)).cursor).toBe(7); // end of "bar"
  });
});

describe("windowText", () => {
  it("returns the whole line when it fits", () => {
    expect(windowText("hello", 5, 20)).toEqual({ slice: "hello", caret: 5 });
  });
  it("shows the tail when the caret is at the end of a long line", () => {
    const { slice, caret } = windowText("0123456789abc", 13, 5); // len 13, width 5 → start = 8
    expect(slice).toBe("89abc"); // last 5 chars
    expect(caret).toBe(slice.length); // caret just past the last visible char
  });
  it("keeps the caret visible when editing mid-line", () => {
    const { slice, caret } = windowText("0123456789abcdef", 8, 6);
    expect(caret).toBeGreaterThanOrEqual(0);
    expect(caret).toBeLessThan(slice.length);
    expect(slice[caret]).toBe("8"); // the char under the caret is in view
  });
});
