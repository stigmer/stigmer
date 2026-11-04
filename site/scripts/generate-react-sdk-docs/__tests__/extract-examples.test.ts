/**
 * Tests for how the kit references (React, React core, Ink) take an
 * `@example` from a TypeDoc comment and write it: one fence keeps its
 * line's attributes and is written as a `tsx` fence carrying them; bare
 * code with no fence is written as `tsx`; and prose around a fence, or a
 * second fence, is refused with the export and its file named, since
 * written whole it would put a fence inside a fence.
 */

import { describe, expect, it } from "vitest";
import { extractExamples, renderExample, type ExampleOwner } from "../mdx-utils";
import type { Comment } from "../typedoc-types";

const OWNER: ExampleOwner = { name: "useThing", sources: [{ fileName: "sdk/react/src/thing/useThing.ts" }] };

/** A comment whose only block tags are `@example`s with the given texts. */
function examples(...texts: string[]): Comment {
  return { summary: [], blockTags: texts.map((text) => ({ tag: "@example", content: [{ kind: "code", text }] })) };
}

describe("extractExamples", () => {
  it("keeps one fence's attributes and its code", () => {
    expect(extractExamples(examples('```tsx title="App.tsx"\nuseThing();\n```'), OWNER)).toEqual([
      { meta: 'title="App.tsx"', code: "useThing();" },
    ]);
  });

  it("takes bare code with no fence as code", () => {
    expect(extractExamples(examples("useThing();\nuseOther();"), OWNER)).toEqual([{ meta: "", code: "useThing();\nuseOther();" }]);
  });

  it("refuses prose after a fence, naming the export and its file", () => {
    const comment = examples("```tsx\nuseThing();\n```\n\nThe hook seeds the composer.");
    expect(() => extractExamples(comment, OWNER)).toThrow(/useThing \(sdk\/react\/src\/thing\/useThing\.ts\)/);
  });

  it("refuses prose before a fence", () => {
    expect(() => extractExamples(examples("Desktop:\n```tsx\nuseThing();\n```"), OWNER)).toThrow(/must be one code fence or bare code/);
  });

  it("refuses two fences in one example", () => {
    expect(() => extractExamples(examples("```tsx\nuseThing();\n```\n```tsx\nuseOther();\n```"), OWNER)).toThrow(
      /give each example its own @example/,
    );
  });

  it("reads every @example tag, and nothing from a comment without one", () => {
    expect(extractExamples(examples("a();", "```ts\nb();\n```"), OWNER).map((e) => e.code)).toEqual(["a();", "b();"]);
    expect(extractExamples({ summary: [] }, OWNER)).toEqual([]);
    expect(extractExamples(undefined, OWNER)).toEqual([]);
  });

  it("skips an @example that holds only whitespace", () => {
    expect(extractExamples(examples("  \n ", "a();"), OWNER)).toEqual([{ meta: "", code: "a();" }]);
  });
});

describe("renderExample", () => {
  it("writes a tsx fence carrying the author's attributes", () => {
    expect(renderExample({ meta: 'title="App.tsx"', code: "useThing();" })).toBe('```tsx title="App.tsx"\nuseThing();\n```\n\n');
  });

  it("writes a bare tsx fence when the author's had no attributes", () => {
    expect(renderExample({ meta: "", code: "useThing();" })).toBe("```tsx\nuseThing();\n```\n\n");
  });
});
