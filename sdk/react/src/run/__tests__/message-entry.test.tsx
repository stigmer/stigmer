// Pins MessageEntry over the thread's message kinds: an agent message
// renders as markdown through Streamdown (mermaid diagrams included) and is
// busy while it is still being written (`live`), a person's message renders
// as a plain bubble, a platform note as muted italic text, and a thinking as
// a collapsible block that hides once settled empty.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { MessageEntry, type ThreadMessage } from "../MessageEntry";
import type { MermaidModule } from "../../internal/mermaid-loader";

// Stub only the library loader: the real MermaidDiagram + markdown overrides
// run end-to-end through Streamdown, so these tests cover the full chat path
// from fenced source to rendered diagram.
vi.mock("../../internal/mermaid-loader", () => ({
  loadMermaid: vi.fn().mockResolvedValue({
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg data-testid='mermaid-svg'></svg>" }),
  } as unknown as MermaidModule),
}));

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  kind: ThreadMessage["kind"],
  text: string,
  opts?: { isStreaming?: boolean },
): ThreadMessage {
  const live = opts?.isStreaming ?? false;
  switch (kind) {
    case "user":
      return { kind, id: "u1", text };
    case "note":
      return { kind, id: "n1", text, processedAt: "" };
    case "message":
    case "thinking":
      return { kind, id: `${kind}-1`, text, live, processedAt: "" };
  }
}

function queryArticle(container: HTMLElement, name: string) {
  return container.querySelector(`[role="article"][aria-label="${name}"]`);
}

// ---------------------------------------------------------------------------
// Agent messages — Streamdown integration
// ---------------------------------------------------------------------------

describe("MessageEntry — agent messages (Streamdown)", () => {
  it("renders agent message content as markdown", () => {
    const msg = makeMessage("message", "Hello **world**");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    expect(article).not.toBeNull();
    expect(article!.textContent).toContain("Hello");
    expect(article!.textContent).toContain("world");

    const strong = article!.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe("world");
  });

  it("sets aria-busy=true when streaming", () => {
    const msg = makeMessage("message", "Streaming...", {
      isStreaming: true,
    });
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    expect(article!.getAttribute("aria-busy")).toBe("true");
  });

  it("sets aria-busy=false when not streaming", () => {
    const msg = makeMessage("message", "Done.");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    expect(article!.getAttribute("aria-busy")).toBe("false");
  });

  it("renders GFM tables without explicit remark-gfm plugin", () => {
    const tableMarkdown = [
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");

    const msg = makeMessage("message", tableMarkdown);
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    const table = article!.querySelector("table");
    expect(table).not.toBeNull();
  });

  it("applies MARKDOWN_COMPONENTS overrides (paragraph styling)", () => {
    const msg = makeMessage("message", "A paragraph");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    const p = article!.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.className).toContain("stg:text-sm");
    expect(p!.className).toContain("stg:text-foreground");
  });

  it("applies MARKDOWN_COMPONENTS overrides (link styling)", () => {
    const msg = makeMessage(
      "message",
      "[click here](https://example.com)",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    const a = article!.querySelector("a");
    expect(a).not.toBeNull();
    expect(a!.className).toContain("stg:text-primary");
    expect(a!.getAttribute("target")).toBe("_blank");
    expect(a!.getAttribute("rel")).toContain("noopener");
  });

  it("applies MARKDOWN_COMPONENTS overrides (code block styling)", () => {
    const msg = makeMessage(
      "message",
      "```js\nconsole.log('hi');\n```",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    const pre = article!.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.className).toContain("stg:rounded-md");
    expect(pre!.className).toContain("stg:bg-muted");
  });

  it("wraps content in stgm-prose container", () => {
    const msg = makeMessage("message", "Hello");
    const { container } = render(<MessageEntry message={msg} />);

    const prose = container.querySelector(".stgm-prose");
    expect(prose).not.toBeNull();
  });

  it("renders a model-wrapped ```markdown plan as rich markdown, not a code block", () => {
    const msg = makeMessage(
      "message",
      "```markdown\n# Plan\n\n1. First step\n2. Second step\n```",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    // The enclosing fence is unwrapped: the heading and list render as elements,
    // and the whole plan is NOT trapped inside a single <pre>.
    expect(article!.querySelector("h1")).not.toBeNull();
    expect(article!.querySelector("ol")).not.toBeNull();
    expect(article!.querySelector("pre")).toBeNull();
    expect(article!.textContent).toContain("Plan");
  });

  it("still renders a genuine ```js code block as a code block", () => {
    const msg = makeMessage(
      "message",
      "```js\nconsole.log('hi');\n```",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    expect(article!.querySelector("pre")).not.toBeNull();
  });

  it("syntax-highlights fenced code in the chat stream (Streamdown path)", () => {
    const msg = makeMessage(
      "message",
      "```go\nfunc main() {}\n```",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    // Streamdown routes fenced code through the shared MARKDOWN_COMPONENTS.code
    // override, so chat highlights identically to the artifact viewer.
    expect(article!.querySelector("code.hljs")).not.toBeNull();
    expect(
      article!.querySelectorAll('span[class*="hljs-"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders a completed ```mermaid fence as a diagram, not a code block", async () => {
    const msg = makeMessage(
      "message",
      "Here is the flow:\n\n```mermaid\nflowchart LR\n  A --> B\n```",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    await waitFor(() =>
      expect(
        article!.querySelector('[role="img"][aria-label="Mermaid diagram"]'),
      ).not.toBeNull(),
    );
    expect(article!.querySelector("[data-testid='mermaid-svg']")).not.toBeNull();
    // The fenced source is no longer shown as a code block.
    expect(article!.querySelector("pre")).toBeNull();
  });

  it("keeps an unclosed ```mermaid fence as a code block while streaming", () => {
    const msg = makeMessage(
      "message",
      "```mermaid\nflowchart LR\n  A --> B",
      { isStreaming: true },
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    // Mid-stream the source stays a plain code block — no diagram, and no
    // half-parsed error flashing.
    expect(
      article!.querySelector('[role="img"][aria-label="Mermaid diagram"]'),
    ).toBeNull();
    expect(article!.textContent).toContain("flowchart LR");
  });
});

// ---------------------------------------------------------------------------
// A person's messages
// ---------------------------------------------------------------------------

describe("MessageEntry — Human messages", () => {
  it("renders human message as plain text", () => {
    const msg = makeMessage("user", "User question");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "User message");
    expect(article).not.toBeNull();
    expect(article!.textContent).toContain("User question");
  });

  it("applies muted background styling", () => {
    const msg = makeMessage("user", "Hello");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "User message");
    expect(article!.className).toContain("stg:bg-muted-subtle");
  });
});

// ---------------------------------------------------------------------------
// Build-from-plan turns — no special human-message treatment
// ---------------------------------------------------------------------------

describe("MessageEntry — Build-from-plan turns", () => {
  it("renders any human message as the ordinary prompt bubble (the thread hides build turns before they reach MessageEntry)", () => {
    // The retired chip treatment lived here; today buildThreadItems skips
    // synthesizing the prompt item for a build turn entirely, so a human
    // message that DOES reach MessageEntry is always ordinary prose.
    const msg = makeMessage("user", "Build from plan");
    const { container } = render(<MessageEntry message={msg} />);

    expect(queryArticle(container, "User message")).not.toBeNull();
    expect(queryArticle(container, "Build from plan")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Platform notes
// ---------------------------------------------------------------------------

describe("MessageEntry — Platform notes", () => {
  it("renders a note", () => {
    const msg = makeMessage("note", "System notice");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "System message");
    expect(article).not.toBeNull();
    expect(article!.textContent).toContain("System notice");
  });

  it("renders with italic muted styling", () => {
    const msg = makeMessage("note", "Notice");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "System message");
    const p = article!.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.className).toContain("italic");
    expect(p!.className).toContain("stg:text-muted-foreground");
  });
});

// ---------------------------------------------------------------------------
// Thinking
// ---------------------------------------------------------------------------

describe("MessageEntry — Thinking messages", () => {
  it("renders thinking message with preview", () => {
    const msg = makeMessage(
      "thinking",
      "Let me consider this problem carefully and think through all the options.",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "Model thinking");
    expect(article).not.toBeNull();
  });

  it("shows spinner icon when streaming", () => {
    const msg = makeMessage("thinking", "", {
      isStreaming: true,
    });
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "Model thinking");
    const svg = article!.querySelector("svg.stg\\:animate-spin");
    expect(svg).not.toBeNull();
  });

  it("returns null for empty non-streaming thinking", () => {
    const msg = makeMessage("thinking", "");
    const { container } = render(<MessageEntry message={msg} />);

    expect(container.innerHTML).toBe("");
  });
});
