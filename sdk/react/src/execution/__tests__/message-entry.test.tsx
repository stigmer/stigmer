import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { MessageEntry } from "../MessageEntry";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  type: MessageType,
  content: string,
  opts?: { isStreaming?: boolean },
) {
  const msg = create(AgentMessageSchema);
  msg.type = type;
  msg.content = content;
  if (opts?.isStreaming) msg.isStreaming = true;
  return msg;
}

function queryArticle(container: HTMLElement, name: string) {
  return container.querySelector(`[role="article"][aria-label="${name}"]`);
}

// ---------------------------------------------------------------------------
// AI Messages — Streamdown integration
// ---------------------------------------------------------------------------

describe("MessageEntry — AI messages (Streamdown)", () => {
  it("renders AI message content as markdown", () => {
    const msg = makeMessage(MessageType.MESSAGE_AI, "Hello **world**");
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
    const msg = makeMessage(MessageType.MESSAGE_AI, "Streaming...", {
      isStreaming: true,
    });
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    expect(article!.getAttribute("aria-busy")).toBe("true");
  });

  it("sets aria-busy=false when not streaming", () => {
    const msg = makeMessage(MessageType.MESSAGE_AI, "Done.");
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

    const msg = makeMessage(MessageType.MESSAGE_AI, tableMarkdown);
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    const table = article!.querySelector("table");
    expect(table).not.toBeNull();
  });

  it("applies MARKDOWN_COMPONENTS overrides (paragraph styling)", () => {
    const msg = makeMessage(MessageType.MESSAGE_AI, "A paragraph");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    const p = article!.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.className).toContain("text-sm");
    expect(p!.className).toContain("text-foreground");
  });

  it("applies MARKDOWN_COMPONENTS overrides (link styling)", () => {
    const msg = makeMessage(
      MessageType.MESSAGE_AI,
      "[click here](https://example.com)",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    const a = article!.querySelector("a");
    expect(a).not.toBeNull();
    expect(a!.className).toContain("text-primary");
    expect(a!.getAttribute("target")).toBe("_blank");
    expect(a!.getAttribute("rel")).toContain("noopener");
  });

  it("applies MARKDOWN_COMPONENTS overrides (code block styling)", () => {
    const msg = makeMessage(
      MessageType.MESSAGE_AI,
      "```js\nconsole.log('hi');\n```",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    const pre = article!.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.className).toContain("rounded-md");
    expect(pre!.className).toContain("bg-muted");
  });

  it("wraps content in stgm-prose container", () => {
    const msg = makeMessage(MessageType.MESSAGE_AI, "Hello");
    const { container } = render(<MessageEntry message={msg} />);

    const prose = container.querySelector(".stgm-prose");
    expect(prose).not.toBeNull();
  });

  it("renders a model-wrapped ```markdown plan as rich markdown, not a code block", () => {
    const msg = makeMessage(
      MessageType.MESSAGE_AI,
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
      MessageType.MESSAGE_AI,
      "```js\nconsole.log('hi');\n```",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "AI response");
    expect(article!.querySelector("pre")).not.toBeNull();
  });

  it("syntax-highlights fenced code in the chat stream (Streamdown path)", () => {
    const msg = makeMessage(
      MessageType.MESSAGE_AI,
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
});

// ---------------------------------------------------------------------------
// Human messages — unchanged
// ---------------------------------------------------------------------------

describe("MessageEntry — Human messages", () => {
  it("renders human message as plain text", () => {
    const msg = makeMessage(MessageType.MESSAGE_HUMAN, "User question");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "User message");
    expect(article).not.toBeNull();
    expect(article!.textContent).toContain("User question");
  });

  it("applies muted background styling", () => {
    const msg = makeMessage(MessageType.MESSAGE_HUMAN, "Hello");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "User message");
    expect(article!.className).toContain("bg-muted-subtle");
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
    const msg = makeMessage(MessageType.MESSAGE_HUMAN, "Build from plan");
    const { container } = render(<MessageEntry message={msg} />);

    expect(queryArticle(container, "User message")).not.toBeNull();
    expect(queryArticle(container, "Build from plan")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// System messages — unchanged
// ---------------------------------------------------------------------------

describe("MessageEntry — System messages", () => {
  it("renders system message", () => {
    const msg = makeMessage(MessageType.MESSAGE_SYSTEM, "System notice");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "System message");
    expect(article).not.toBeNull();
    expect(article!.textContent).toContain("System notice");
  });

  it("renders with italic muted styling", () => {
    const msg = makeMessage(MessageType.MESSAGE_SYSTEM, "Notice");
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "System message");
    const p = article!.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.className).toContain("italic");
    expect(p!.className).toContain("text-muted-foreground");
  });
});

// ---------------------------------------------------------------------------
// Thinking messages — unchanged
// ---------------------------------------------------------------------------

describe("MessageEntry — Thinking messages", () => {
  it("renders thinking message with preview", () => {
    const msg = makeMessage(
      MessageType.MESSAGE_THINKING,
      "Let me consider this problem carefully and think through all the options.",
    );
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "Model thinking");
    expect(article).not.toBeNull();
  });

  it("shows spinner icon when streaming", () => {
    const msg = makeMessage(MessageType.MESSAGE_THINKING, "", {
      isStreaming: true,
    });
    const { container } = render(<MessageEntry message={msg} />);

    const article = queryArticle(container, "Model thinking");
    const svg = article!.querySelector("svg.animate-spin");
    expect(svg).not.toBeNull();
  });

  it("returns null for empty non-streaming thinking", () => {
    const msg = makeMessage(MessageType.MESSAGE_THINKING, "");
    const { container } = render(<MessageEntry message={msg} />);

    expect(container.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Tool / unspecified — renders nothing
// ---------------------------------------------------------------------------

describe("MessageEntry — Tool and unspecified messages", () => {
  it("renders nothing for TOOL messages", () => {
    const msg = makeMessage(MessageType.MESSAGE_TOOL, "tool result");
    const { container } = render(<MessageEntry message={msg} />);

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for UNSPECIFIED messages", () => {
    const msg = makeMessage(
      MessageType.MESSAGE_TYPE_UNSPECIFIED,
      "unknown",
    );
    const { container } = render(<MessageEntry message={msg} />);

    expect(container.innerHTML).toBe("");
  });
});
