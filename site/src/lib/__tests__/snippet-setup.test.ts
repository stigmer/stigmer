/**
 * Pins the one split of a code example's hidden setup (../snippet-setup.mjs)
 * and its two readers on the site: the remark plugin that drops the setup
 * from the rendered block and its copy button, and the markdown exports.
 * The docs snippet gate reads the same function to compile the setup, so a
 * marker one reader honours and another does not cannot ship.
 */
import { describe, expect, it } from "vitest";
import type { Code, Root } from "mdast";
import { cleanContent, hideFenceSetup } from "../llms-pages";
import { hideSnippetSetup } from "../remark-snippet-setup";
import { SETUP_MARKERS, splitSnippetSetup } from "../snippet-setup.mjs";

const EXAMPLE = ["declare const user: PlatformUser;", "// ---cut---", 'await stigmer.run.create({ org: user.org, message: "hi" });'].join("\n");

describe("the setup split", () => {
  it("keeps what follows the marker and counts the hidden lines", () => {
    expect(splitSnippetSetup("typescript", EXAMPLE)).toEqual({
      setup: "declare const user: PlatformUser;",
      body: 'await stigmer.run.create({ org: user.org, message: "hi" });',
      hiddenLines: 2,
    });
  });

  it("uses each language's own comment for the marker", () => {
    expect(splitSnippetSetup("python", "user = cast(User, None)\n# ---cut---\nprint(user)").body).toBe("print(user)");
    expect(splitSnippetSetup("go", "var user User\n// ---cut---\nfmt.Println(user)").body).toBe("fmt.Println(user)");
    expect(splitSnippetSetup("python", "x = 1\n// ---cut---\ny = 2").hiddenLines).toBe(0);
    expect(Object.keys(SETUP_MARKERS).sort()).toEqual(["go", "java", "py", "python", "ts", "tsx", "typescript"]);
  });

  it("leaves a fence without a marker, or in another language, whole", () => {
    expect(splitSnippetSetup("ts", "a;\nb;").body).toBe("a;\nb;");
    expect(splitSnippetSetup("bash", "# ---cut---\nls").body).toBe("# ---cut---\nls");
    expect(splitSnippetSetup(undefined, "// ---cut---").body).toBe("// ---cut---");
  });

  it("refuses a second marker", () => {
    expect(() => splitSnippetSetup("java", "a\n// ---cut---\nb\n// ---cut---\nc")).toThrow(/setup ends once/);
  });
});

describe("the rendered block", () => {
  it("carries only the body, so neither the page nor its copy button shows the setup", () => {
    const tree: Root = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "Prose." }] },
        { type: "code", lang: "typescript", value: EXAMPLE },
        { type: "code", lang: "bash", value: "# ---cut---\nls" },
      ],
    };
    hideSnippetSetup(tree);
    const code = tree.children.filter((node): node is Code => node.type === "code");
    expect(code.map((node) => node.value)).toEqual(['await stigmer.run.create({ org: user.org, message: "hi" });', "# ---cut---\nls"]);
  });
});

describe("the markdown export", () => {
  it("drops the setup and the marker, inside an indented fence too, and keeps every other line", () => {
    const page = ["Intro.", "", "```typescript", EXAMPLE, "```", "", "1. Step", "", "   ```python", "   user = cast(User, None)", "   # ---cut---", "   print(user)", "   ```", "", "After."].join("\n");
    expect(hideFenceSetup(page)).toBe(
      ["Intro.", "", "```typescript", 'await stigmer.run.create({ org: user.org, message: "hi" });', "```", "", "1. Step", "", "   ```python", "   print(user)", "   ```", "", "After."].join("\n"),
    );
    expect(cleanContent(page, "https://example.test")).not.toContain("---cut---");
  });

  it("reads a fence's end as CommonMark does: a run indented four spaces is the fence's own text", () => {
    const page = ["```typescript", "declare const a: string;", "// ---cut---", "const md = `", "    ```", "`;", "```", "After."].join("\n");
    expect(hideFenceSetup(page)).toBe(["```typescript", "const md = `", "    ```", "`;", "```", "After."].join("\n"));
  });

  it("leaves a page without setup exactly as it was", () => {
    const page = "Text.\n\n```go\nx := 1\n```\n\n````md\n```ts\n// ---cut---\n```\n````\n";
    expect(hideFenceSetup(page)).toBe(page);
  });
});
