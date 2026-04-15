import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../markdown.js";

describe("renderMarkdown", () => {
  it("renders plain text without modification", () => {
    const result = renderMarkdown("Hello world");
    expect(result).toContain("Hello world");
  });

  it("renders bold text with ANSI styling", () => {
    const result = renderMarkdown("This is **bold** text");
    expect(result).toContain("bold");
    expect(result).not.toBe("This is **bold** text");
  });

  it("renders code blocks", () => {
    const result = renderMarkdown("```\nconst x = 1;\n```");
    expect(result).toContain("const x = 1");
  });

  it("renders headings", () => {
    const result = renderMarkdown("# Title");
    expect(result).toContain("Title");
  });

  it("renders lists", () => {
    const result = renderMarkdown("- item one\n- item two");
    expect(result).toContain("item one");
    expect(result).toContain("item two");
  });

  it("handles empty content", () => {
    const result = renderMarkdown("");
    expect(result).toBe("");
  });

  it("trims trailing whitespace", () => {
    const result = renderMarkdown("Hello");
    expect(result).toBe(result.trimEnd());
  });

  it("accepts custom width", () => {
    const result = renderMarkdown("A very long sentence that might wrap", 40);
    expect(result).toContain("A very long sentence");
  });
});
