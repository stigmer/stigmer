// Pins for the Go-style JSON serializer. Each case documents a way Go's
// encoding/json differs from JSON.stringify; the expected strings were
// produced by the Go toolchain's behavior (json.MarshalIndent(v, "", "  "))
// that wrote every committed artifact.
import { describe, expect, it } from "vitest";

import { marshalIndent } from "./gojson.js";

describe("marshalIndent", () => {
  it("indents with two spaces, space after colon, no trailing newline", () => {
    const got = marshalIndent({ name: "agent", fields: [1, 2] });
    expect(got).toBe('{\n  "name": "agent",\n  "fields": [\n    1,\n    2\n  ]\n}');
  });

  it("emits compact forms for empty array and object at any depth", () => {
    expect(marshalIndent([])).toBe("[]");
    expect(marshalIndent({})).toBe("{}");
    expect(marshalIndent({ a: [], b: {} })).toBe('{\n  "a": [],\n  "b": {}\n}');
  });

  it("distinguishes [] (empty non-nil slice) from null (nil) from omitted (omitempty)", () => {
    const got = marshalIndent({ fields: [], values: null, dropped: undefined });
    expect(got).toBe('{\n  "fields": [],\n  "values": null\n}');
  });

  it("HTML-escapes < > & the way Go does (committed schemas contain these)", () => {
    expect(marshalIndent("Format: <org-id> & <name>")).toBe(
      '"Format: \\u003corg-id\\u003e \\u0026 \\u003cname\\u003e"',
    );
  });

  it("escapes control characters and U+2028/U+2029", () => {
    expect(marshalIndent("a\nb\tc\rd\u0001e\u2028f\u2029g")).toBe(
      '"a\\nb\\tc\\rd\\u0001e\\u2028f\\u2029g"',
    );
    expect(marshalIndent('quote " backslash \\')).toBe('"quote \\" backslash \\\\"');
  });

  it("keeps struct (plain object) keys in insertion order", () => {
    const got = marshalIndent({ zebra: 1, alpha: 2, mango: 3 });
    expect(got).toBe('{\n  "zebra": 1,\n  "alpha": 2,\n  "mango": 3\n}');
  });

  it("sorts Map (Go map) keys lexicographically", () => {
    const got = marshalIndent(
      new Map<string, number>([
        ["zebra", 1],
        ["alpha", 2],
        ["mango", 3],
      ]),
    );
    expect(got).toBe('{\n  "alpha": 2,\n  "mango": 3,\n  "zebra": 1\n}');
  });

  it("formats numbers on Go's float boundaries", () => {
    expect(marshalIndent(1)).toBe("1");
    expect(marshalIndent(1.5)).toBe("1.5");
    expect(marshalIndent(-0)).toBe("-0");
    expect(marshalIndent(0.000001)).toBe("0.000001");
    expect(marshalIndent(0.0000001)).toBe("1e-7");
    expect(marshalIndent(1.5e-8)).toBe("1.5e-8");
    expect(marshalIndent(1e20)).toBe("100000000000000000000");
    expect(marshalIndent(1e21)).toBe("1e+21");
    expect(marshalIndent(9007199254740993n)).toBe("9007199254740993");
  });

  it("rejects NaN and Infinity like Go's encoding/json", () => {
    expect(() => marshalIndent(NaN)).toThrow();
    expect(() => marshalIndent(Infinity)).toThrow();
  });

  it("replaces lone surrogates with \\ufffd like Go replaces invalid UTF-8", () => {
    expect(marshalIndent("a\ud800b")).toBe('"a\\ufffdb"');
  });

  it("marshals a nested shape matching a real schema fragment", () => {
    const got = marshalIndent({
      name: "AgentSpec",
      protoFile: "apis/ai/stigmer/agentic/agent/v1/spec.proto",
      fields: [
        {
          name: "instructions",
          type: "string",
          description: "System instructions for the agent.",
          validation: { required: true, minLength: 1 },
        },
      ],
    });
    expect(got).toBe(
      "{\n" +
        '  "name": "AgentSpec",\n' +
        '  "protoFile": "apis/ai/stigmer/agentic/agent/v1/spec.proto",\n' +
        '  "fields": [\n' +
        "    {\n" +
        '      "name": "instructions",\n' +
        '      "type": "string",\n' +
        '      "description": "System instructions for the agent.",\n' +
        '      "validation": {\n' +
        '        "required": true,\n' +
        '        "minLength": 1\n' +
        "      }\n" +
        "    }\n" +
        "  ]\n" +
        "}",
    );
  });
});
