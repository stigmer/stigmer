import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import Markdown from "react-markdown";
import {
  MARKDOWN_COMPONENTS,
  REMARK_PLUGINS,
  extractLeadingH1,
  unwrapEnclosingMarkdownFence,
} from "../markdown-components";

// Stub the diagram component: these tests verify the DISPATCH seam (which
// fences route to the diagram vs the code block), not mermaid rendering —
// that contract is covered by mermaid-diagram.test.tsx.
vi.mock("../MermaidDiagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => (
    <div data-testid="mermaid-diagram">{chart}</div>
  ),
}));

afterEach(cleanup);

/** The shared `code` override, typed for direct rendering in tests. */
const CodeComponent = MARKDOWN_COMPONENTS.code as ComponentType<{
  className?: string;
  children?: ReactNode;
}>;

/** The shared `pre` override, typed for direct rendering in tests. */
const PreComponent = MARKDOWN_COMPONENTS.pre as ComponentType<{
  children?: ReactNode;
}>;

describe("unwrapEnclosingMarkdownFence", () => {
  describe("unwraps a whole-message markdown fence", () => {
    it.each([
      ["```markdown tag", "```markdown\n# Plan\n- step\n```", "# Plan\n- step"],
      ["```md tag", "```md\n# Plan\n```", "# Plan"],
      ["case-insensitive tag", "```Markdown\n# Plan\n```", "# Plan"],
      ["uppercase md", "```MD\n# Plan\n```", "# Plan"],
      [
        "tilde-free body with inner code fence preserved",
        "```markdown\n# Plan\n```ts\nconst x = 1;\n```\n```",
        "# Plan\n```ts\nconst x = 1;\n```",
      ],
      [
        "surrounding whitespace is ignored",
        "\n\n```markdown\n# Plan\n```\n\n",
        "# Plan",
      ],
      [
        "longer-than-three backtick fence",
        "````markdown\n# Plan\n````",
        "# Plan",
      ],
    ])("%s", (_label, input, expected) => {
      expect(unwrapEnclosingMarkdownFence(input)).toBe(expected);
    });
  });

  describe("leaves everything else untouched (returns the original)", () => {
    it.each([
      ["plain markdown (no fence)", "# Plan\n\n- step one\n- step two"],
      ["a bare ``` fence (ambiguous — could be code)", "```\n# Plan\n```"],
      ["a language-tagged code block", "```js\nconsole.log('hi');\n```"],
      ["an unclosed fence (mid-stream)", "```markdown\n# Plan in progr"],
      ["trailing content after the fence", "```markdown\n# Plan\n```\nthen more"],
      ["leading content before the fence", "intro\n```markdown\n# Plan\n```"],
      ["a richer info string than markdown", "```markdown title\n# Plan\n```"],
      ["an empty fenced block", "```markdown\n```"],
      ["plain prose", "Here is the plan you asked for."],
      ["empty string", ""],
    ])("%s", (_label, input) => {
      expect(unwrapEnclosingMarkdownFence(input)).toBe(input);
    });
  });

  it("is idempotent — a once-unwrapped plan is left alone", () => {
    const wrapped = "```markdown\n# Plan\n- a\n```";
    const once = unwrapEnclosingMarkdownFence(wrapped);
    expect(unwrapEnclosingMarkdownFence(once)).toBe(once);
  });

  describe("allowBareFence (plan-document surfaces)", () => {
    it.each([
      ["a bare whole-body fence", "```\n# Plan\n- step\n```", "# Plan\n- step"],
      [
        "a bare fence with surrounding whitespace",
        "\n```\n# Plan\n```\n",
        "# Plan",
      ],
      [
        "still unwraps the tagged form",
        "```markdown\n# Plan\n```",
        "# Plan",
      ],
    ])("unwraps %s", (_label, input, expected) => {
      expect(unwrapEnclosingMarkdownFence(input, true)).toBe(expected);
    });

    it.each([
      ["a language-tagged code block", "```python\nprint('hi')\n```"],
      ["an unclosed bare fence (mid-stream)", "```\n# Plan in progr"],
      ["trailing content after the fence", "```\n# Plan\n```\nthen more"],
      ["leading content before the fence", "intro\n```\n# Plan\n```"],
      ["plain markdown (no fence)", "# Plan\n\n- step"],
    ])("leaves %s untouched even with allowBareFence", (_label, input) => {
      expect(unwrapEnclosingMarkdownFence(input, true)).toBe(input);
    });
  });
});

describe("extractLeadingH1", () => {
  it("splits a leading # heading into title and body", () => {
    expect(extractLeadingH1("# The Plan\n\nFirst paragraph.")).toEqual({
      title: "The Plan",
      body: "First paragraph.",
    });
  });

  it("handles a document that is only a heading", () => {
    expect(extractLeadingH1("# Just a Title")).toEqual({
      title: "Just a Title",
      body: "",
    });
  });

  it("ignores leading whitespace before the heading", () => {
    expect(extractLeadingH1("\n\n# The Plan\nBody")).toEqual({
      title: "The Plan",
      body: "Body",
    });
  });

  it("returns null title when the document does not open with an H1", () => {
    const doc = "Intro paragraph.\n\n# Later Heading\nBody";
    expect(extractLeadingH1(doc)).toEqual({ title: null, body: doc });
  });

  it("does not treat deeper headings as the title", () => {
    const doc = "## Section\nBody";
    expect(extractLeadingH1(doc)).toEqual({ title: null, body: doc });
  });

  it("trims trailing whitespace from the title", () => {
    expect(extractLeadingH1("#  Spaced Title  \nBody").title).toBe(
      "Spaced Title",
    );
  });
});

describe("MARKDOWN_COMPONENTS.code (shared highlight seam)", () => {
  it("syntax-highlights a fenced block with a known language", () => {
    const { container } = render(
      <CodeComponent className="language-go">
        {"func main() {}"}
      </CodeComponent>,
    );

    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("hljs");
    expect(code!.className).toContain("language-go");
    expect(
      container.querySelectorAll('span[class*="hljs-"]').length,
    ).toBeGreaterThan(0);
  });

  it("falls back to flat text for an unknown language (no token spans)", () => {
    const { container } = render(
      <CodeComponent className="language-hcl">
        {'resource "x" {}'}
      </CodeComponent>,
    );

    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain('resource "x" {}');
    expect(container.querySelectorAll('span[class*="hljs-"]').length).toBe(0);
  });

  it("falls back to flat for non-string children (e.g. a streaming caret)", () => {
    const { container } = render(
      <CodeComponent className="language-go">
        <span data-testid="caret">x</span>
      </CodeComponent>,
    );

    // Renders children untouched, no throw, no tokenization attempted.
    expect(container.querySelector('[data-testid="caret"]')).not.toBeNull();
    expect(container.querySelectorAll('span[class*="hljs-"]').length).toBe(0);
  });

  it("leaves inline code unhighlighted and unboxed by hljs", () => {
    const { container } = render(<CodeComponent>{"inlineToken"}</CodeComponent>);

    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.className).not.toContain("hljs");
    expect(code!.className).toContain("bg-muted");
    expect(code!.textContent).toBe("inlineToken");
  });
});

describe("MARKDOWN_COMPONENTS.pre (mermaid dispatch seam)", () => {
  const CHART = "flowchart LR\n  A --> B";

  it("routes an explicit ```mermaid fence to the diagram, dropping the <pre> wrapper", () => {
    const { container } = render(
      <PreComponent>
        <code className="language-mermaid">{CHART}</code>
      </PreComponent>,
    );

    const diagram = container.querySelector('[data-testid="mermaid-diagram"]');
    expect(diagram).not.toBeNull();
    expect(diagram!.textContent).toBe(CHART);
    // The diagram replaces the <pre> entirely — a block container inside
    // <pre> would be invalid HTML and inherit code-block chrome.
    expect(container.querySelector("pre")).toBeNull();
  });

  it("matches language-mermaid among multiple classes", () => {
    const { container } = render(
      <PreComponent>
        <code className="language-mermaid extra-class">{CHART}</code>
      </PreComponent>,
    );

    expect(
      container.querySelector('[data-testid="mermaid-diagram"]'),
    ).not.toBeNull();
  });

  it.each([
    [
      "a different language",
      <code key="go" className="language-go">{"func main() {}"}</code>,
    ],
    [
      "a language merely PREFIXED with mermaid",
      <code key="pfx" className="language-mermaidjs">{CHART}</code>,
    ],
    ["an untagged fence", <code key="bare">{CHART}</code>],
    [
      "non-string code children",
      <code key="node" className="language-mermaid">
        <span>{CHART}</span>
      </code>,
    ],
    ["plain-text children (no code element)", CHART],
  ])("keeps the ordinary <pre> code block for %s", (_label, children) => {
    const { container } = render(<PreComponent>{children}</PreComponent>);

    expect(container.querySelector('[data-testid="mermaid-diagram"]')).toBeNull();
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.className).toContain("bg-muted");
  });

  it("dispatches through real react-markdown (the artifact/skill surface path)", () => {
    // Renders an actual document instead of synthetic elements, proving the
    // element shape react-markdown hands to `pre` matches what the seam
    // detects. The Streamdown (chat) path has the equivalent end-to-end
    // coverage in message-entry.test.tsx.
    const doc = `Before\n\n\`\`\`mermaid\n${CHART}\n\`\`\`\n\n\`\`\`go\nfunc main() {}\n\`\`\``;
    const { container } = render(
      <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {doc}
      </Markdown>,
    );

    const diagram = container.querySelector('[data-testid="mermaid-diagram"]');
    expect(diagram).not.toBeNull();
    expect(diagram!.textContent).toContain("flowchart LR");
    // The sibling go fence still renders as an ordinary highlighted block.
    expect(container.querySelector("pre code.language-go")).not.toBeNull();
  });
});
