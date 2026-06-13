import { describe, it, expect } from "vitest";
import { renderMarkdown, lineText, type Line } from "../../src/ui/markdown.js";
import { theme } from "../../src/ui/theme.js";

const text = (lines: Line[]) => lines.map(lineText).join("\n");
const allSpans = (lines: Line[]) => lines.flatMap((l) => l.spans);
const find = (lines: Line[], t: string) => allSpans(lines).find((s) => s.text.includes(t));

describe("renderMarkdown — inline", () => {
  it("bold strips markers and sets bold", () => {
    const lines = renderMarkdown("**hi** there", 40);
    const hi = find(lines, "hi")!;
    expect(hi.bold).toBe(true);
    expect(text(lines)).toContain("hi there");
    expect(text(lines)).not.toContain("**");
  });

  it("italic and strikethrough", () => {
    expect(find(renderMarkdown("*em*", 40), "em")!.italic).toBe(true);
    expect(find(renderMarkdown("~~gone~~", 40), "gone")!.strikethrough).toBe(true);
  });

  it("nested strong>em>code merges all flags onto one span", () => {
    const lines = renderMarkdown("**_`x`_**", 40);
    const x = find(lines, "x")!;
    expect(x.bold).toBe(true);
    expect(x.italic).toBe(true);
    expect(x.color).toBe(theme.accent); // codespan color
  });

  it("inline code is accent with a bg chip", () => {
    const lines = renderMarkdown("use `go test` now", 40);
    const code = find(lines, "go test")!;
    expect(code.color).toBe(theme.accent);
    expect(code.bg).toBeTruthy();
    expect(text(lines)).not.toContain("`");
  });

  it("link underlines + appends a dim href, omits href when equal to text", () => {
    const withHref = renderMarkdown("[docs](http://e.com)", 60);
    expect(find(withHref, "docs")!.underline).toBe(true);
    expect(text(withHref)).toContain("http://e.com");
    const auto = renderMarkdown("<http://e.com>", 60);
    // autolink: text === href → not duplicated
    expect(text(auto).match(/http:\/\/e\.com/g)!.length).toBe(1);
  });

  it("image renders as [img: alt]", () => {
    expect(text(renderMarkdown("![cat](c.png)", 40))).toContain("[img: cat]");
  });

  it("decodes the fixed entity set", () => {
    expect(text(renderMarkdown("a &amp; b &lt;c&gt;", 40))).toContain("a & b <c>");
  });
});

describe("renderMarkdown — blocks", () => {
  it("headings strip # and style by depth", () => {
    const h1 = renderMarkdown("# Title", 40);
    expect(text(h1)).toContain("TITLE"); // h1 uppercased
    expect(text(h1)).not.toContain("#");
    const h1Title = find(h1, "TITLE")!;
    expect(h1Title.bold).toBe(true);
    expect(h1Title.color).toBe(theme.accent);
    // h1 emits an underline rule line beneath
    expect(h1.some((l) => lineText(l).includes("─"))).toBe(true);
    const h3 = renderMarkdown("### Sub", 40);
    expect(find(h3, "Sub")!.color).toBe(theme.purple);
  });

  it("unordered list gets bullet markers", () => {
    const lines = renderMarkdown("- one\n- two", 40);
    expect(text(lines)).toContain("• one");
    expect(text(lines)).toContain("• two");
  });

  it("ordered list respects start and right-aligns markers", () => {
    const lines = renderMarkdown("5. a\n6. b", 40);
    expect(text(lines)).toContain("5. a");
    expect(text(lines)).toContain("6. b");
  });

  it("task list renders checkboxes", () => {
    const lines = renderMarkdown("- [x] done\n- [ ] todo", 40);
    expect(text(lines)).toContain("[x] done");
    expect(text(lines)).toContain("[ ] todo");
    expect(find(lines, "[x]")!.color).toBe(theme.good);
  });

  it("fenced code: lang header, verbatim body, markers absent, inline NOT parsed", () => {
    const lines = renderMarkdown("```go\nfn() // **not bold**\n```", 60);
    expect(text(lines)).toContain("go"); // lang label
    expect(text(lines)).toContain("fn() // **not bold**"); // inline markers literal in code
    expect(lineText(lines[0])).not.toContain("```");
    // body line carries a code bg
    expect(allSpans(lines).some((s) => s.bg && s.text.includes("fn()"))).toBe(true);
  });

  it("diff-fenced code colors +/- lines", () => {
    const lines = renderMarkdown("```diff\n+added\n-removed\n```", 60);
    expect(allSpans(lines).some((s) => s.text.includes("+added") && s.color === theme.good)).toBe(true);
    expect(allSpans(lines).some((s) => s.text.includes("-removed") && s.color === theme.bad)).toBe(true);
  });

  it("blockquote prefixes a rule and dims", () => {
    const lines = renderMarkdown("> quoted", 40);
    expect(text(lines)).toContain("▏ ");
    expect(text(lines)).toContain("quoted");
  });

  it("hr renders a full-width rule", () => {
    const lines = renderMarkdown("---", 20);
    expect(lineText(lines[0])).toMatch(/^─+$/);
  });

  it("table renders aligned columns with a header rule", () => {
    const lines = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |", 40);
    const t = text(lines);
    expect(t).toContain("a");
    expect(t).toContain("b");
    expect(t).toContain("│"); // column separator
    expect(lines.some((l) => lineText(l).includes("┼"))).toBe(true); // header rule
  });
});

describe("renderMarkdown — streaming robustness", () => {
  it("balances an unterminated fence so in-progress code renders as code", () => {
    const lines = renderMarkdown("```js\nconst x = 1", 40);
    expect(allSpans(lines).some((s) => s.text.includes("const x = 1") && s.bg)).toBe(true);
  });

  it("never throws across every truncation of a rich document", () => {
    const doc = [
      "# Title",
      "",
      "A paragraph with **bold**, *em*, `code` and [a link](http://x.com).",
      "",
      "- one",
      "- two `inline`",
      "",
      "```go",
      "func main() {}",
      "```",
      "",
      "> a quote",
      "",
      "| h1 | h2 |",
      "|----|----|",
      "| a  | b  |",
    ].join("\n");
    for (let n = 0; n <= doc.length; n++) {
      expect(() => renderMarkdown(doc.slice(0, n), 50)).not.toThrow();
    }
  });

  it("dangling emphasis renders the marker literally (no flicker-flip)", () => {
    expect(text(renderMarkdown("this is **bo", 40))).toContain("**bo");
  });
});

describe("renderMarkdown — review-confirmed fixes", () => {
  it("empty link text shows the href as the underlined link (not an invisible span)", () => {
    const lines = renderMarkdown("[](http://example.com)", 60);
    const link = find(lines, "http://example.com")!;
    expect(link.underline).toBe(true);
    expect(link.color).toBe(theme.accent);
    // Not rendered as a dim parenthetical.
    expect(text(lines)).not.toContain("(http://example.com)");
  });

  it("does not duplicate an entity-encoded href that equals the shown text", () => {
    const lines = renderMarkdown("[&lt;tag&gt;](&lt;tag&gt;)", 60);
    // "<tag>" appears once — no " (<tag>)" parenthetical.
    expect(text(lines).match(/<tag>/g)!.length).toBe(1);
  });

  it("balances a tilde fence with a tilde close (no stray backticks)", () => {
    const lines = renderMarkdown("~~~py\nx = 1", 40);
    expect(allSpans(lines).some((s) => s.text.includes("x = 1") && s.bg)).toBe(true);
    expect(text(lines)).not.toContain("```");
  });

  it("does NOT treat a 4-space-indented fence as a fence (CommonMark)", () => {
    // 4-space indent is an indented code block, not a fence — balanceFences must
    // not append a synthetic close that corrupts the rest of the doc.
    const lines = renderMarkdown("    ```js\n    code", 40);
    expect(() => lines).not.toThrow();
    // No trailing standalone fence marker line should appear.
    expect(lines.every((l) => lineText(l).trim() !== "```")).toBe(true);
  });

  it("blockquote text is dim + italic (dim flag set, not just dim color)", () => {
    const q = find(renderMarkdown("> quoted", 40), "quoted")!;
    expect(q.italic).toBe(true);
    expect(q.dim).toBe(true);
    expect(q.color).toBe(theme.dim);
  });

  it("blockquote preserves inline code color while dimming plain text", () => {
    const lines = renderMarkdown("> see `x` here", 40);
    expect(find(lines, "x")!.color).toBe(theme.accent); // code keeps accent
    expect(find(lines, "see")!.dim).toBe(true); // plain text dimmed
  });

  it("h1 underline does not exceed the wrapped title width", () => {
    const lines = renderMarkdown("# " + "X".repeat(40), 20);
    const rule = lines.find((l) => /^─+$/.test(lineText(l)))!;
    expect(lineText(rule).length).toBeLessThanOrEqual(20);
  });
});

describe("renderMarkdown — previously-untested token paths", () => {
  it("inline html renders as dim text", () => {
    const lines = renderMarkdown("text <span>raw</span> more", 60);
    const raw = find(lines, "span")!;
    expect(raw.dim).toBe(true);
    expect(raw.color).toBe(theme.dim);
  });

  it("block-level html renders wrapped and dim", () => {
    const lines = renderMarkdown("<div>raw block</div>", 40);
    expect(text(lines)).toContain("raw block");
    expect(allSpans(lines).some((s) => s.text.includes("raw block") && s.dim)).toBe(true);
  });

  it("escaped characters render literally and are not styled", () => {
    const lines = renderMarkdown("\\*not bold\\*", 40);
    expect(text(lines)).toContain("*not bold*");
    expect(find(lines, "not bold")!.bold).not.toBe(true);
  });

  it("a hard break (two trailing spaces) splits into multiple lines", () => {
    const lines = renderMarkdown("line1  \nline2", 40);
    expect(text(lines)).toContain("line1");
    expect(text(lines)).toContain("line2");
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe("renderMarkdown — lineText round-trips for search", () => {
  it("reconstructs plain text used by ChatPane search", () => {
    const lines = renderMarkdown("hello **world** and `code`", 80);
    expect(text(lines)).toContain("hello world and code");
  });

  it("never returns zero lines", () => {
    expect(renderMarkdown("", 40).length).toBeGreaterThan(0);
  });
});
