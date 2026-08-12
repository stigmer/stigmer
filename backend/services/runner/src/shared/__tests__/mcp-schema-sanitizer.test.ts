import { describe, it, expect } from "vitest";
import { loadMcpTools } from "@langchain/mcp-adapters";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { sanitizeSchemaPatterns } from "../mcp-schema-sanitizer.js";

// PayPal's real-world specimen from issue #420: legal as a plain ECMAScript
// regex (Annex B identity escapes), invalid under the /u flag.
const TOXIC_PATTERN = "^https\\:\\/\\/";

describe("sanitizeSchemaPatterns — walker semantics", () => {
  it("drops a unicode-invalid pattern and reports it", () => {
    const schema = {
      type: "object",
      properties: {
        url: { type: "string", pattern: TOXIC_PATTERN },
      },
    };

    const dropped = sanitizeSchemaPatterns(schema);

    expect(schema.properties.url).toEqual({ type: "string" });
    expect(dropped).toEqual([
      {
        location: "/properties/url/pattern",
        pattern: TOXIC_PATTERN,
        compilesWithoutUnicodeFlag: true,
      },
    ]);
  });

  it("flags patterns that are broken outright (invalid without /u too)", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string", pattern: "(unclosed" } },
    };

    const dropped = sanitizeSchemaPatterns(schema);

    expect(schema.properties.name).toEqual({ type: "string" });
    expect(dropped[0].compilesWithoutUnicodeFlag).toBe(false);
  });

  it("leaves clean schemas byte-identical", () => {
    const schema = {
      type: "object",
      properties: {
        url: { type: "string", pattern: "^https://" },
        tags: { type: "array", items: { type: "string", pattern: "^[a-z]+$" } },
      },
      patternProperties: { "^x-": { type: "string" } },
      additionalProperties: false,
      required: ["url"],
    };
    const before = JSON.parse(JSON.stringify(schema));

    expect(sanitizeSchemaPatterns(schema)).toEqual([]);
    expect(schema).toEqual(before);
  });

  it("never touches a property literally named 'pattern'", () => {
    // 'pattern' as a property NAME is data, not a keyword — but the pattern
    // KEYWORD on that property's own schema is still sanitized.
    const schema = {
      type: "object",
      properties: {
        pattern: { type: "string", pattern: TOXIC_PATTERN },
      },
    };

    const dropped = sanitizeSchemaPatterns(schema);

    expect(Object.keys(schema.properties)).toEqual(["pattern"]);
    expect(schema.properties.pattern).toEqual({ type: "string" });
    expect(dropped[0].location).toBe("/properties/pattern/pattern");
  });

  it("leaves a non-string pattern value alone", () => {
    const schema = { type: "object", properties: { n: { pattern: 123 } } };
    expect(sanitizeSchemaPatterns(schema)).toEqual([]);
    expect((schema.properties.n as { pattern: unknown }).pattern).toBe(123);
  });

  it("reaches nested schema positions", () => {
    const schema = {
      type: "object",
      properties: {
        choice: {
          anyOf: [
            { type: "string", pattern: TOXIC_PATTERN },
            { type: "number" },
          ],
        },
        tuple: {
          type: "array",
          items: [{ type: "string", pattern: TOXIC_PATTERN }],
        },
        names: { propertyNames: { pattern: TOXIC_PATTERN } },
      },
      $defs: {
        link: { type: "string", pattern: TOXIC_PATTERN },
      },
      dependencies: {
        // Array form is dependentRequired (names, not schemas) — untouched.
        a: ["b"],
        c: { properties: { d: { type: "string", pattern: TOXIC_PATTERN } } },
      },
    };

    const dropped = sanitizeSchemaPatterns(schema);

    expect(dropped.map((d) => d.location).sort()).toEqual([
      "/$defs/link/pattern",
      "/dependencies/c/properties/d/pattern",
      "/properties/choice/anyOf/0/pattern",
      "/properties/names/propertyNames/pattern",
      "/properties/tuple/items/0/pattern",
    ]);
    expect(schema.dependencies.a).toEqual(["b"]);
  });

  it("terminates on a cyclic schema graph", () => {
    const node: Record<string, unknown> = {
      type: "object",
      properties: { url: { type: "string", pattern: TOXIC_PATTERN } },
    };
    node.not = node;

    const dropped = sanitizeSchemaPatterns(node);
    expect(dropped).toHaveLength(1);
  });

  it("ignores non-object input", () => {
    expect(sanitizeSchemaPatterns(undefined)).toEqual([]);
    expect(sanitizeSchemaPatterns("pattern")).toEqual([]);
    expect(sanitizeSchemaPatterns([{ pattern: TOXIC_PATTERN }])).toEqual([]);
  });
});

describe("sanitizeSchemaPatterns — never-tighten invariant (patternProperties)", () => {
  // Slash-free /u-invalid key so the expected report location needs no
  // JSON-pointer escaping (the walker escapes `/` in map keys as `~1`).
  const TOXIC_KEY = "^x\\:";

  it("drops a broken patternProperties key and relaxes restrictive additionalProperties", () => {
    const schema = {
      type: "object",
      patternProperties: {
        [TOXIC_KEY]: { type: "string" },
        "^clean-": { type: "number" },
      },
      additionalProperties: false,
    };

    const dropped = sanitizeSchemaPatterns(schema);

    expect(dropped).toEqual([
      {
        location: `/patternProperties/${TOXIC_KEY}`,
        pattern: TOXIC_KEY,
        compilesWithoutUnicodeFlag: true,
      },
    ]);
    expect(schema.patternProperties).toEqual({ "^clean-": { type: "number" } });
    // Keys the dropped pattern used to match would fall through to
    // additionalProperties: false and be falsely REJECTED — the relaxation
    // is what keeps sanitization strictly loosening.
    expect("additionalProperties" in schema).toBe(false);
  });

  it("removes an emptied patternProperties and relaxes a restrictive subschema additionalProperties", () => {
    const schema = {
      type: "object",
      patternProperties: { [TOXIC_KEY]: { type: "string" } },
      additionalProperties: { type: "number" },
      unevaluatedProperties: false,
    };

    sanitizeSchemaPatterns(schema);

    expect("patternProperties" in schema).toBe(false);
    expect("additionalProperties" in schema).toBe(false);
    expect("unevaluatedProperties" in schema).toBe(false);
  });

  it("keeps additionalProperties when no patternProperties entry was dropped", () => {
    const schema = {
      type: "object",
      patternProperties: { "^clean-": { type: "string" } },
      additionalProperties: false,
    };

    sanitizeSchemaPatterns(schema);

    expect(schema.additionalProperties).toBe(false);
  });

  it("proves the loosened schema through the real validator: previously matched keys stay accepted", async () => {
    // End-to-end through @langchain/core's own validation path (the exact
    // consumer that compiles patterns with /u): after sanitization, an input
    // whose key only the dropped pattern used to match must validate — not
    // fall through to additionalProperties: false.
    const schema = {
      type: "object" as const,
      patternProperties: { "^x\\:": { type: "string" as const } },
      additionalProperties: false,
    };
    sanitizeSchemaPatterns(schema);

    // Default generics: the JSON-schema constructor arm types invoke input
    // as ToolCall otherwise, rejecting the pattern-shaped key at compile time.
    const tool: DynamicStructuredTool = new DynamicStructuredTool({
      name: "probe",
      description: "d",
      schema,
      func: async () => "ok",
    });

    await expect(tool.invoke({ "x:key": "value" })).resolves.toBe("ok");
  });
});

describe("sanitizeSchemaPatterns — issue #420 regression pin", () => {
  // The issue's exact repro: a tool loaded through the real adapter with the
  // PayPal pattern shape loads fine but fails EVERY invocation with
  // "SyntaxError: Invalid regular expression: /^https\:\/\//u".
  const toxicTool = {
    name: "toxic",
    description: "d",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", pattern: TOXIC_PATTERN } },
    },
  };
  const fakeClient = {
    listTools: async () => ({ tools: [toxicTool] }),
    callTool: async () => ({ content: [{ type: "text", text: "called" }] }),
  };

  it("negative control: without sanitization the tool is uncallable (the defect)", async () => {
    const tools = await loadMcpTools("srv", fakeClient as never, {
      throwOnLoadError: true,
    });

    await expect(tools[0].invoke({ url: "https://x.com" })).rejects.toThrow(
      /Invalid regular expression/,
    );
  });

  it("after sanitization the same tool invokes successfully", async () => {
    const tools = await loadMcpTools("srv", fakeClient as never, {
      throwOnLoadError: true,
    });

    const dropped = sanitizeSchemaPatterns(tools[0].schema);

    expect(dropped).toEqual([
      {
        location: "/properties/url/pattern",
        pattern: TOXIC_PATTERN,
        compilesWithoutUnicodeFlag: true,
      },
    ]);
    await expect(tools[0].invoke({ url: "https://x.com" })).resolves.toBe(
      "called",
    );
  });
});
