import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ToolResultView } from "@stigmer/sdk";
import { ResultView, summarizeResultView } from "../ResultView";

afterEach(cleanup);

describe("ResultView", () => {
  it("renders an edit diff with add/remove counts from the envelope", () => {
    const view: ToolResultView = {
      type: "diff",
      path: "/workspace/x.md",
      linesAdded: 40,
      linesRemoved: 0,
    };
    const { container } = render(<ResultView view={view} />);
    expect(container.textContent).toContain("+40");
    expect(container.textContent).toContain("-0");
  });

  it("renders a computed diff hunk from old/new text", () => {
    const view: ToolResultView = {
      type: "diff",
      path: "/workspace/x.md",
      oldText: "hello",
      newText: "hello world",
    };
    const { container } = render(<ResultView view={view} />);
    // The new line is rendered as an addition.
    expect(container.textContent).toContain("hello world");
  });

  it("renders a terminal with a non-zero exit badge", () => {
    const view: ToolResultView = {
      type: "terminal",
      stdout: "boom",
      stderr: "",
      exitCode: 1,
    };
    const { container } = render(<ResultView view={view} />);
    expect(container.textContent).toContain("exit 1");
    expect(container.textContent).toContain("boom");
  });

  it("renders a search match list", () => {
    const view: ToolResultView = {
      type: "search",
      matches: [{ text: "a" }, { text: "b" }],
      count: 2,
    };
    const { container } = render(<ResultView view={view} />);
    expect(container.textContent).toContain("2 matches");
  });

  it("renders unknown JSON results as a labeled code block, not a raw dump", () => {
    const view: ToolResultView = { type: "json", value: { a: 1 } };
    const { container } = render(<ResultView view={view} />);
    expect(container.textContent).toContain("Result");
    expect(container.textContent).toContain('"a": 1');
  });

  it("renders an error", () => {
    const view: ToolResultView = { type: "error", message: "it broke" };
    const { container } = render(<ResultView view={view} />);
    expect(container.textContent).toContain("Error");
    expect(container.textContent).toContain("it broke");
  });

  it("renders nothing for empty", () => {
    const { container } = render(<ResultView view={{ type: "empty" }} />);
    expect(container.textContent).toBe("");
  });
});

describe("summarizeResultView", () => {
  it("summarizes a diff", () => {
    expect(
      summarizeResultView({ type: "diff", path: "x", linesAdded: 3, linesRemoved: 1 }),
    ).toBe("+3 -1");
  });

  it("summarizes a failed terminal but not a successful one", () => {
    expect(summarizeResultView({ type: "terminal", stdout: "", stderr: "", exitCode: 2 })).toBe("exit 2");
    expect(summarizeResultView({ type: "terminal", stdout: "", stderr: "", exitCode: 0 })).toBeNull();
  });

  it("summarizes search and list counts", () => {
    expect(summarizeResultView({ type: "search", matches: [], count: 3 })).toBe("3 matches");
    expect(summarizeResultView({ type: "list", entries: [], count: 1 })).toBe("1 item");
  });

  it("returns null when there is nothing to summarize", () => {
    expect(summarizeResultView({ type: "text", text: "hi" })).toBeNull();
  });
});
