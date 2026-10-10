/**
 * Pins mock rendering (mock.ts): the body cut from its frontmatter, both
 * substitutions, the fixtures confinement, and the saved tools/list shapes.
 */

import { describe, expect, it } from "vitest";
import { fixturePath, mockBodyOf, parseToolsList, renderMockAnswer } from "../mock.js";

describe("mockBodyOf", () => {
  it("cuts the frontmatter and keeps a file without one", () => {
    expect(mockBodyOf("---\nexpect:\n  title: string\n---\n\nCreated issue #4821: {{input.title}}\n")).toBe(
      "Created issue #4821: {{input.title}}",
    );
    expect(mockBodyOf("plain answer\n")).toBe("plain answer");
  });
});

describe("renderMockAnswer", () => {
  const fixtures: Record<string, string> = { "fixtures/42.json": '{"status":"shipped"}' };
  const read = (path: string): string | undefined => fixtures[path];

  it("inserts input fields, strings as written and the rest as JSON", () => {
    expect(
      renderMockAnswer("Created #1: {{input.title}} ({{ input.meta.n }}) {{input.tags}} [{{input.none}}]", {
        title: "Crash",
        meta: { n: 3 },
        tags: ["a"],
      }, read),
    ).toEqual({ ok: true, text: 'Created #1: Crash (3) ["a"] []' });
  });

  it("inserts a fixture named from the input", () => {
    expect(renderMockAnswer("{{file:fixtures/{input.order_id}.json}}", { order_id: "42" }, read)).toEqual({
      ok: true,
      text: '{"status":"shipped"}',
    });
  });

  it("refuses a fixture outside fixtures/ and a missing one", () => {
    expect(renderMockAnswer("{{file:fixtures/{input.id}}}", { id: "../../secret" }, read)).toEqual({
      ok: false,
      error: "the fixture 'fixtures/../../secret' is outside the mock's fixtures directory",
    });
    expect(renderMockAnswer("{{file:fixtures/7.json}}", {}, read)).toEqual({
      ok: false,
      error: "the fixture 'fixtures/7.json' does not exist",
    });
  });
});

describe("fixturePath", () => {
  it.each([
    ["fixtures/a.json", "fixtures/a.json"],
    ["fixtures/./sub//b.txt", "fixtures/sub/b.txt"],
    ["fixtures/../x", undefined],
    ["/fixtures/a", undefined],
    ["other/a", undefined],
    ["fixtures", undefined],
    ["fixtures\\a", undefined],
  ])("%s -> %s", (name, path) => {
    expect(fixturePath(name)).toBe(path);
  });
});

describe("parseToolsList", () => {
  const tool = { name: "create_issue", description: "Create an issue", inputSchema: { type: "object" } };

  it("reads a tools/list result, its JSON-RPC response, or a bare list", () => {
    expect(parseToolsList(JSON.stringify({ tools: [tool] }))).toEqual([tool]);
    expect(parseToolsList(JSON.stringify({ jsonrpc: "2.0", result: { tools: [tool] } }))).toEqual([tool]);
    expect(parseToolsList(JSON.stringify([tool, { description: "no name" }]))).toEqual([tool]);
  });

  it("reads anything else as no tools", () => {
    expect(parseToolsList("{nope")).toEqual([]);
    expect(parseToolsList('{"x":1}')).toEqual([]);
  });
});
