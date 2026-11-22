/**
 * The host app's own tools: what a conversation may declare and which
 * calls reach the host. The control plane (when a session declares them)
 * and the runner (before offering them and on every call) run these same
 * functions, so each rule is proven once here.
 */

import { describe, expect, it } from "vitest";

import { CUSTOM_TOOL_CHECK_BUDGET_MS, CUSTOM_TOOL_LIMITS, customToolInputProblem, customToolsProblem, isReservedCustomToolName, type CustomToolDeclaration } from "../custom-tools.js";

const FORM: CustomToolDeclaration = {
  name: "show_registration_form",
  description: "Open the service registration form beside the chat, prefilled.",
  inputSchema: { type: "object", properties: { service: { type: "string" }, port: { type: "integer", minimum: 1 } }, required: ["service"], additionalProperties: false },
};

function tool(overrides: Partial<CustomToolDeclaration>): CustomToolDeclaration {
  return { ...FORM, ...overrides };
}

describe("customToolsProblem", () => {
  it("accepts a well-formed declaration, and none at all", () => {
    expect(customToolsProblem([FORM, tool({ name: "pick-date" })])).toBeUndefined();
    expect(customToolsProblem([])).toBeUndefined();
  });

  it("refuses a name outside the grammar or over 64 characters, naming the limit", () => {
    expect(customToolsProblem([tool({ name: "show form" })])).toBe("The name of custom tool 'show form' may hold only letters, digits, _ and -.");
    expect(customToolsProblem([tool({ name: "" })])).toBe("The name of custom tool 1 may hold only letters, digits, _ and -.");
    expect(customToolsProblem([tool({ name: "a".repeat(64) })])).toBeUndefined();
    expect(customToolsProblem([tool({ name: "a".repeat(65) })])).toBe(`The name of custom tool '${"a".repeat(65)}' is 65 characters; a custom tool's name is at most 64.`);
  });

  it("refuses an engine's own tool name in any case, and an MCP tool's prefix", () => {
    for (const name of ["Bash", "bash", "Read", "Task", "ToolSearch", "StructuredOutput", "execute", "read_file", "web_fetch", "write_todos", "stop_background_command", "TASK"]) {
      expect(customToolsProblem([tool({ name })]), name).toBe(`The name of custom tool '${name}' is a built-in tool's; choose another.`);
    }
    expect(customToolsProblem([tool({ name: "mcp__forms__show" })])).toBe("The name of custom tool 'mcp__forms__show' may not start with mcp__, which names an MCP server's tools.");
    expect(isReservedCustomToolName("MCP__x")).toBe(true);
    expect(isReservedCustomToolName("show_form")).toBe(false);
  });

  it("refuses a repeated name and an empty or long description", () => {
    expect(customToolsProblem([FORM, FORM])).toBe("Two custom tools are named 'show_registration_form'; each name may appear once.");
    expect(customToolsProblem([tool({ description: "  " })])).toBe("The description of custom tool 'show_registration_form' is empty; the agent reads it to know when to call the tool.");
    expect(customToolsProblem([tool({ description: "d".repeat(4097) })])).toBe("The description of custom tool 'show_registration_form' is 4097 characters; at most 4096.");
  });

  it("refuses a schema that is not an object schema or cannot be read", () => {
    expect(customToolsProblem([tool({ inputSchema: "object" })])).toBe("The input_schema of custom tool 'show_registration_form' must be a JSON Schema object.");
    expect(customToolsProblem([tool({ inputSchema: [] })])).toBe("The input_schema of custom tool 'show_registration_form' must be a JSON Schema object.");
    expect(customToolsProblem([tool({ inputSchema: { type: "string" } })])).toBe('The input_schema of custom tool \'show_registration_form\' must describe an object ({"type": "object", ...}).');
    expect(customToolsProblem([tool({ inputSchema: { type: "object", properties: { a: { $ref: "#/$defs/missing" } } } })])).toBe(
      "The input_schema of custom tool 'show_registration_form' cannot be read as a JSON Schema: its $ref \"#/$defs/missing\" names nothing in the schema (a custom tool's schema is self-contained).",
    );
    expect(customToolsProblem([tool({ inputSchema: { type: "object", properties: { a: { $ref: "https://example.com/s.json" } } } })])).toMatch(/its \$ref "https:\/\/example\.com\/s\.json" names nothing/);
    expect(customToolsProblem([tool({ inputSchema: { type: "object", $defs: { port: { type: "integer" } }, properties: { a: { $ref: "#/$defs/port" } } } })])).toBeUndefined();
    // A ref to the root, into an array, and through an escaped key resolves; one through a value that is no object, inside an array, or not a string does not.
    expect(customToolsProblem([tool({ inputSchema: { type: "object", properties: { self: { $ref: "#" }, first: { $ref: "#/allOf/0" }, slash: { $ref: "#/$defs/a~1b~0c" } }, allOf: [{ type: "object" }], $defs: { "a/b~c": { type: "string" } } } })])).toBeUndefined();
    expect(customToolsProblem([tool({ inputSchema: { type: "object", properties: { a: { $ref: "#/type/x" } } } })])).toMatch(/its \$ref "#\/type\/x" names nothing/);
    expect(customToolsProblem([tool({ inputSchema: { type: "object", anyOf: [{ type: "object" }, { $ref: "#/nowhere" }] } })])).toMatch(/its \$ref "#\/nowhere" names nothing/);
    expect(customToolsProblem([tool({ inputSchema: { type: "object", properties: { a: { $ref: 7 } } } })])).toMatch(/its \$ref "7" names nothing/);
    // A malformed escape, and a key only inherited, name nothing: refused as such, never an error of the check's own.
    expect(customToolsProblem([tool({ inputSchema: { type: "object", properties: { a: { $ref: "#/%" } } } })])).toMatch(/its \$ref "#\/%" names nothing/);
    for (const inherited of ["#/constructor", "#/__proto__", "#/allOf/length", "#/allOf/01", "#/allOf/1"]) {
      expect(customToolsProblem([tool({ inputSchema: { type: "object", allOf: [{ type: "object" }], properties: { a: { $ref: inherited } } } })]), inherited).toMatch(/names nothing/);
    }
  });

  it("refuses a pattern the validator could not compile, in a property or as a property name, wherever it sits", () => {
    expect(customToolsProblem([tool({ inputSchema: { type: "object", properties: { a: { type: "string", pattern: "(" } } } })])).toBe(
      "The input_schema of custom tool 'show_registration_form' cannot be read as a JSON Schema: its pattern \"(\" is not a regular expression.",
    );
    expect(customToolsProblem([tool({ inputSchema: { type: "object", patternProperties: { "[": {} } } })])).toMatch(/its pattern "\[" is not a regular expression/);
    expect(customToolsProblem([tool({ inputSchema: { type: "object", anyOf: [{ properties: { a: { pattern: "*" } } }] } })])).toMatch(/its pattern "\*" is not a regular expression/);
    expect(customToolsProblem([tool({ inputSchema: { type: "object", properties: { a: { type: "string", pattern: "^[a-z]+$" } }, patternProperties: { "^x-": {} } } })])).toBeUndefined();
  });

  it("refuses more tools or more schema bytes than a conversation may hold", () => {
    const many = Array.from({ length: CUSTOM_TOOL_LIMITS.maxTools + 1 }, (_, i) => tool({ name: `t${i}` }));
    expect(customToolsProblem(many)).toBe("A conversation may declare at most 32 custom tools; this one declares 33.");
    expect(customToolsProblem(many.slice(0, 32))).toBeUndefined();
    const big = { type: "object", description: "x".repeat(40 * 1024) };
    expect(customToolsProblem([tool({ name: "a", inputSchema: big }), tool({ name: "b", inputSchema: big })])).toMatch(/^The custom tools' input schemas hold \d+ bytes in all; at most 65536\.$/);
  });
});

describe("customToolInputProblem", () => {
  it("admits input the schema accepts", () => {
    expect(customToolInputProblem(FORM, { service: "payments", port: 8080 })).toBeUndefined();
    const nested: CustomToolDeclaration = { ...FORM, inputSchema: { type: "object", $defs: { port: { type: "integer" } }, properties: { ports: { type: "array", items: { $ref: "#/$defs/port" } } } } };
    expect(customToolInputProblem(nested, { ports: [1, 2] })).toBeUndefined();
    expect(customToolInputProblem(nested, { ports: [1, "two"] })).toBe(
      "The input does not match show_registration_form's input schema (/ports/1: Instance type \"string\" is invalid. Expected \"integer\".); the call did not run. Call it again with input that matches.",
    );
  });

  it("names each mismatch for the model and says the call did not run", () => {
    expect(customToolInputProblem(FORM, { port: 0, extra: true })).toBe(
      "The input does not match show_registration_form's input schema (the input: Instance does not have required property \"service\".; /port: 0 is less than 1.; /extra: not a property this tool takes); the call did not run. Call it again with input that matches.",
    );
    expect(customToolInputProblem(FORM, "not an object")).toMatch(/^The input does not match show_registration_form's input schema \(the input: Instance type "string" is invalid\. Expected "object"\./);
  });

  it("falls back to the validator's own words when every error is one that only wraps another", () => {
    const closed: CustomToolDeclaration = { ...FORM, inputSchema: { type: "object", properties: { legacy: false } } };
    expect(customToolInputProblem(closed, { legacy: 1 })).toMatch(/^The input does not match show_registration_form's input schema \(.+\); the call did not run\./);
  });

  it("stops a check that runs past its budget and refuses the call, rather than holding the thread", () => {
    const backtracks: CustomToolDeclaration = { ...FORM, inputSchema: { type: "object", properties: { a: { type: "string", pattern: "^(a+)+$" } } } };
    const started = Date.now();
    expect(customToolInputProblem(backtracks, { a: `${"a".repeat(40)}!` })).toBe(
      "The input could not be checked against show_registration_form's input schema in time (a pattern in the schema takes too long on this input); the call did not run.",
    );
    expect(Date.now() - started, "stopped near the budget").toBeLessThan(CUSTOM_TOOL_CHECK_BUDGET_MS * 8);
    expect(customToolInputProblem(backtracks, { a: "aaaa" }), "the same pattern on ordinary input passes").toBeUndefined();
  });

  it("says the input could not be checked when the schema itself cannot be read", () => {
    const broken: CustomToolDeclaration = { ...FORM, inputSchema: { type: "object", properties: { a: { type: "string", pattern: "(" } } } };
    expect(customToolInputProblem(broken, { a: "x" })).toMatch(/^The input could not be checked against show_registration_form's input schema \(.+\); the call did not run\.$/);
  });
});
