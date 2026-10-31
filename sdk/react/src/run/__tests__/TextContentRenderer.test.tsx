import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TextContentRenderer } from "../TextContentRenderer";

afterEach(cleanup);

describe("TextContentRenderer — markdown", () => {
  const wrappedPlan = "```markdown\n# Plan\n\n1. First\n2. Second\n```";

  it("unwraps a model-wrapped ```markdown plan in the Rendered view", () => {
    const { container } = render(
      <TextContentRenderer content={wrappedPlan} fileName="plan.md" />,
    );

    // Rendered is the default tab: the heading/list render as real elements and
    // the plan is not trapped inside a single <pre>.
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("keeps the Source view byte-faithful to the stored file", () => {
    const { container } = render(
      <TextContentRenderer content={wrappedPlan} fileName="plan.md" />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Source" }));

    // Source shows the raw bytes — including the enclosing fence we hid in the
    // Rendered view — so a download/copy stays faithful to what the agent wrote.
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("```markdown");
  });

  it("leaves an already-rich markdown plan unchanged", () => {
    const { container } = render(
      <TextContentRenderer
        content={"# Plan\n\n- only step"}
        fileName="plan.md"
      />,
    );

    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("syntax-highlights fenced code blocks via the shared seam", () => {
    const md = "# Notes\n\n```go\nfunc main() {}\n```\n";
    const { container } = render(
      <TextContentRenderer content={md} fileName="notes.md" />,
    );

    // Same shared `MARKDOWN_COMPONENTS.code` override the chat stream uses, so
    // the react-markdown file path colorizes code identically.
    const code = container.querySelector("code.hljs");
    expect(code).not.toBeNull();
    expect(
      container.querySelectorAll('span[class*="hljs-"]').length,
    ).toBeGreaterThan(0);
  });
});

describe("TextContentRenderer — truncation", () => {
  it("draws the truncation strip as the caution notice under the file", () => {
    render(<TextContentRenderer content="partial" fileName="log.txt" isTruncated />);

    const strip = screen.getByText(/Content was truncated/);
    expect(strip.className).toContain("stg:bg-status-degraded-subtle");
    expect(strip.className).toContain("stg:text-status-degraded");
    expect(strip.className).toContain("stg:border-t");
    expect(strip.className).not.toContain("warning");
  });

  it("draws no strip for a whole file", () => {
    render(<TextContentRenderer content="whole" fileName="log.txt" />);
    expect(screen.queryByText(/Content was truncated/)).toBeNull();
  });
});

describe("TextContentRenderer — JSON", () => {
  it("colours a number in the at-risk colour the theme contract measures on the page", () => {
    render(<TextContentRenderer content={'{"retries": 3}'} fileName="config.json" />);
    expect(screen.getByText("3").className).toContain("stg:text-status-degraded");
  });

  it("colours a string in the ready colour the theme contract measures on the page", () => {
    render(<TextContentRenderer content={'{"mode": "fast"}'} fileName="config.json" />);
    expect(screen.getByText('"fast"').className).toContain("stg:text-status-ready");
  });
});

describe("TextContentRenderer — reveal (jump-to-line)", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    // happy-dom lacks a real scrollIntoView; the hook calls it optionally.
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView =
      scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
  });

  it("renders addressable lines and highlights the target row for plain text", () => {
    const { container } = render(
      <TextContentRenderer
        content={"one\ntwo\nthree"}
        fileName="notes.txt"
        reveal={{ line: 2, nonce: 1 }}
      />,
    );

    // Every line is addressable; exactly the target row carries the highlight.
    expect(container.querySelectorAll("[data-line]").length).toBe(3);
    const target = container.querySelector('[data-line="2"]');
    expect(target?.className).toContain("stg:bg-primary-subtle");
    expect(container.querySelectorAll(".stg\\:bg-primary-subtle").length).toBe(1);
  });

  it("does not highlight anything when the target line is out of range", () => {
    const { container } = render(
      <TextContentRenderer
        content={"one\ntwo"}
        fileName="notes.txt"
        reveal={{ line: 99, nonce: 1 }}
      />,
    );
    expect(container.querySelectorAll(".stg\\:bg-primary-subtle").length).toBe(0);
  });

  it("forces Markdown to its Source (line-faithful) view when revealing", () => {
    const { container } = render(
      <TextContentRenderer
        content={"# Heading\n\ntext"}
        fileName="doc.md"
        reveal={{ line: 1, nonce: 1 }}
      />,
    );
    // Source is line-numbered <pre>, not the rendered <h1>.
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("pre")).not.toBeNull();
    expect(container.querySelector('[data-line="1"]')).not.toBeNull();
    // The Rendered/Source toggle is still offered.
    expect(screen.getByRole("tab", { name: "Source" })).toBeTruthy();
  });

  it("renders JSON raw (not reformatted) when revealing, so line numbers hold", () => {
    // Minified single-line JSON: pretty-printing would expand it to many lines
    // and shift line 1. Raw rendering keeps it one addressable row.
    const { container } = render(
      <TextContentRenderer
        content={'{"a":1,"b":2}'}
        fileName="data.json"
        reveal={{ line: 1, nonce: 1 }}
      />,
    );
    const rows = container.querySelectorAll("[data-line]");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('{"a":1,"b":2}');
  });

  it("scrolls the target line into view", () => {
    render(
      <TextContentRenderer
        content={"one\ntwo\nthree"}
        fileName="notes.txt"
        reveal={{ line: 3, nonce: 1 }}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
