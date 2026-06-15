import { describe, it, expect } from "vitest";
import { unwrapEnclosingMarkdownFence } from "../markdown-components";

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
});
