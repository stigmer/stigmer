import { describe, it, expect } from "vitest";
import {
  isStrictExpr,
  sanitizeExpr,
  normalizeSingleQuotedStrings,
  preprocessUuid,
  evaluateExpression,
  evaluateString,
  traverseAndEvaluate,
  checkIfStatement,
  evaluateExpressionBatch,
  extractEmbeddedExpressions,
  hasEmbeddedExpressions,
  interpolateString,
  stringifyInterpolatedValue,
} from "../expression.js";

// ─────────────────────────────────────────────────────────────────────
// Expression Detection
// ─────────────────────────────────────────────────────────────────────

describe("isStrictExpr", () => {
  it("detects valid strict expressions", () => {
    expect(isStrictExpr("${ .name }")).toBe(true);
    expect(isStrictExpr("${ $context.userId }")).toBe(true);
    expect(isStrictExpr("${ .a + .b }")).toBe(true);
    expect(isStrictExpr("${ now }")).toBe(true);
    expect(isStrictExpr("${ 1 == 1 }")).toBe(true);
  });

  it("rejects non-expressions", () => {
    expect(isStrictExpr("hello")).toBe(false);
    expect(isStrictExpr("${.name}")).toBe(false);
    expect(isStrictExpr("${ .name}")).toBe(false);
    expect(isStrictExpr("${.name }")).toBe(false);
    expect(isStrictExpr("")).toBe(false);
    expect(isStrictExpr("$ { .name }")).toBe(false);
  });
});

describe("sanitizeExpr", () => {
  it("strips the expression wrapper", () => {
    expect(sanitizeExpr("${ .name }")).toBe(".name");
    expect(sanitizeExpr("${ $context.userId }")).toBe("$context.userId");
    expect(sanitizeExpr("${ .a + .b }")).toBe(".a + .b");
  });
});

// ─────────────────────────────────────────────────────────────────────
// UUID Preprocessing
// ─────────────────────────────────────────────────────────────────────

describe("preprocessUuid", () => {
  it("replaces uuid with a UUID string", () => {
    const { expr, hadUuid } = preprocessUuid("uuid");
    expect(hadUuid).toBe(true);
    expect(expr).toMatch(/^"[0-9a-f-]{36}"$/);
  });

  it("does not modify expressions without uuid", () => {
    const { expr, hadUuid } = preprocessUuid(".name");
    expect(hadUuid).toBe(false);
    expect(expr).toBe(".name");
  });

  it("replaces multiple uuid occurrences with different values", () => {
    const { expr, hadUuid } = preprocessUuid('{ a: uuid, b: uuid }');
    expect(hadUuid).toBe(true);
    const uuids = expr.match(/"[0-9a-f-]{36}"/g);
    expect(uuids).toHaveLength(2);
    expect(uuids![0]).not.toBe(uuids![1]);
  });

  it("does not replace uuid inside quoted strings (word boundary)", () => {
    const { expr, hadUuid } = preprocessUuid('"contains uuid_suffix"');
    expect(hadUuid).toBe(false);
    expect(expr).toBe('"contains uuid_suffix"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Single Expression Evaluation
// ─────────────────────────────────────────────────────────────────────

describe("evaluateExpression", () => {
  const emptyVars: Record<string, unknown> = {};

  it("evaluates dot paths", async () => {
    const result = await evaluateExpression(".name", { name: "test" }, emptyVars);
    expect(result).toBe("test");
  });

  it("evaluates nested dot paths", async () => {
    const result = await evaluateExpression(
      ".a.b.c",
      { a: { b: { c: 42 } } },
      emptyVars,
    );
    expect(result).toBe(42);
  });

  it("evaluates arithmetic", async () => {
    const result = await evaluateExpression(
      ".a + .b",
      { a: 10, b: 32 },
      emptyVars,
    );
    expect(result).toBe(42);
  });

  it("evaluates comparisons", async () => {
    expect(await evaluateExpression(".x > 5", { x: 10 }, emptyVars)).toBe(true);
    expect(await evaluateExpression(".x <= 5", { x: 3 }, emptyVars)).toBe(true);
    expect(await evaluateExpression(".x == 10", { x: 10 }, emptyVars)).toBe(true);
    expect(await evaluateExpression(".x != null", { x: 1 }, emptyVars)).toBe(true);
    expect(await evaluateExpression(".x != null", { x: null }, emptyVars)).toBe(false);
  });

  it("evaluates pipe expressions", async () => {
    const result = await evaluateExpression(
      ". | length",
      [1, 2, 3, 4, 5],
      emptyVars,
    );
    expect(result).toBe(5);
  });

  it("evaluates object construction", async () => {
    const result = await evaluateExpression(
      "{ greeting: .first, target: .second }",
      { first: "hello", second: "world" },
      emptyVars,
    );
    expect(result).toEqual({ greeting: "hello", target: "world" });
  });

  it("evaluates object merge", async () => {
    const result = await evaluateExpression(
      '. + { newKey: "added" }',
      { existing: "value" },
      emptyVars,
    );
    expect(result).toEqual({ existing: "value", newKey: "added" });
  });

  it("evaluates identity expression", async () => {
    const input = { a: 1, b: 2 };
    const result = await evaluateExpression(".", input, emptyVars);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("evaluates with state variables", async () => {
    const stateVars = {
      $context: { userId: 42 },
      $data: { items: [1, 2, 3] },
      $env: {},
      $input: null,
      $output: null,
    };

    const result = await evaluateExpression(
      "$context.userId",
      null,
      stateVars,
    );
    expect(result).toBe(42);
  });

  it("evaluates $data variable access", async () => {
    const stateVars = {
      $context: null,
      $data: { items: ["a", "b", "c"] },
      $env: {},
      $input: null,
      $output: null,
    };

    const result = await evaluateExpression(
      "$data.items | length",
      null,
      stateVars,
    );
    expect(result).toBe(3);
  });

  it("evaluates context merge expression from golden YAML 09", async () => {
    const stateVars = {
      $context: { existingKey: "preserved" },
      $data: {},
      $env: {},
      $input: null,
      $output: null,
    };
    const taskOutput = { newData: "from task" };

    const result = await evaluateExpression(
      "$context + { initialize: . }",
      taskOutput,
      stateVars,
    );
    expect(result).toEqual({
      existingKey: "preserved",
      initialize: taskOutput,
    });
  });

  it("evaluates with null input normalized to empty object", async () => {
    const result = await evaluateExpression("1 == 1", null, emptyVars);
    expect(result).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// evaluateString
// ─────────────────────────────────────────────────────────────────────

describe("evaluateString", () => {
  it("evaluates strict expressions", async () => {
    const result = await evaluateString(
      "${ .name }",
      { name: "hello" },
      {},
    );
    expect(result).toBe("hello");
  });

  it("returns non-expressions as-is", async () => {
    const result = await evaluateString("plain text", {}, {});
    expect(result).toBe("plain text");
  });

  it("returns empty string as-is", async () => {
    const result = await evaluateString("", {}, {});
    expect(result).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Recursive Tree Traversal
// ─────────────────────────────────────────────────────────────────────

describe("traverseAndEvaluate", () => {
  it("evaluates expressions in a flat object", async () => {
    const obj = {
      static: "hello",
      dynamic: "${ .value }",
    };
    const result = await traverseAndEvaluate(obj, { value: 42 }, {});
    expect(result).toEqual({
      static: "hello",
      dynamic: 42,
    });
  });

  it("evaluates expressions in nested objects", async () => {
    const obj = {
      outer: {
        inner: "${ .name }",
        static: true,
      },
    };
    const result = await traverseAndEvaluate(obj, { name: "deep" }, {});
    expect(result).toEqual({
      outer: {
        inner: "deep",
        static: true,
      },
    });
  });

  it("evaluates expressions in arrays", async () => {
    const arr = ["${ .a }", "static", "${ .b }"];
    const result = await traverseAndEvaluate(arr, { a: 1, b: 2 }, {});
    expect(result).toEqual([1, "static", 2]);
  });

  it("passes through non-string primitives", async () => {
    expect(await traverseAndEvaluate(42, {}, {})).toBe(42);
    expect(await traverseAndEvaluate(true, {}, {})).toBe(true);
    expect(await traverseAndEvaluate(null, {}, {})).toBeNull();
    expect(await traverseAndEvaluate(undefined, {}, {})).toBeUndefined();
  });

  it("handles the set task from golden YAML 01", async () => {
    const setObj = {
      workflow_started: true,
    };
    const result = await traverseAndEvaluate(setObj, {}, {});
    expect(result).toEqual({ workflow_started: true });
  });

  it("handles the set task from golden YAML 07 (expressions)", async () => {
    const setObj = {
      computed: "${ .a + .b }",
      message: "Data injected",
    };
    const result = await traverseAndEvaluate(setObj, { a: 10, b: 32 }, {});
    expect(result).toEqual({
      computed: 42,
      message: "Data injected",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Conditional Evaluation
// ─────────────────────────────────────────────────────────────────────

describe("checkIfStatement", () => {
  it("returns true when no condition is specified", async () => {
    expect(await checkIfStatement(undefined, {}, {})).toBe(true);
  });

  it("evaluates boolean true condition", async () => {
    expect(await checkIfStatement("${ .valid }", { valid: true }, {})).toBe(true);
  });

  it("evaluates boolean false condition", async () => {
    expect(await checkIfStatement("${ .valid }", { valid: false }, {})).toBe(false);
  });

  it("evaluates comparison expression", async () => {
    const stateVars = {
      $data: { valid: true },
      $context: null,
      $env: {},
      $input: null,
      $output: null,
    };
    expect(
      await checkIfStatement("${ $data.valid == true }", null, stateVars),
    ).toBe(true);
  });

  it('treats string "TRUE" as true (case-insensitive)', async () => {
    expect(await checkIfStatement("${ .val }", { val: "TRUE" }, {})).toBe(true);
    expect(await checkIfStatement("${ .val }", { val: "true" }, {})).toBe(true);
    expect(await checkIfStatement("${ .val }", { val: "True" }, {})).toBe(true);
  });

  it('treats string "1" as true', async () => {
    expect(await checkIfStatement("${ .val }", { val: "1" }, {})).toBe(true);
  });

  it("treats other strings as false", async () => {
    expect(await checkIfStatement("${ .val }", { val: "no" }, {})).toBe(false);
    expect(await checkIfStatement("${ .val }", { val: "0" }, {})).toBe(false);
  });

  it("evaluates the literal 1 == 1 from golden YAML 09", async () => {
    expect(await checkIfStatement("${ 1 == 1 }", null, {})).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Batch Evaluation
// ─────────────────────────────────────────────────────────────────────

describe("evaluateExpressionBatch", () => {
  it("evaluates multiple expressions against the same input", async () => {
    const results = await evaluateExpressionBatch(
      {
        name: ".name",
        computed: ".a + .b",
        check: ".x > 5",
      },
      { name: "test", a: 10, b: 32, x: 10 },
      {},
    );

    expect(results).toEqual({
      name: "test",
      computed: 42,
      check: true,
    });
  });

  it("returns empty map for empty input", async () => {
    const results = await evaluateExpressionBatch({}, {}, {});
    expect(results).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────
// Embedded Expression Extraction (brace-depth tracking)
// ─────────────────────────────────────────────────────────────────────

describe("extractEmbeddedExpressions", () => {
  it("extracts a single embedded expression", () => {
    const results = extractEmbeddedExpressions("Hello ${ .name }!");
    expect(results).toHaveLength(1);
    expect(results[0].expr).toBe(".name");
    expect(results[0].start).toBe(6);
    expect(results[0].end).toBe(16);
  });

  it("extracts multiple embedded expressions", () => {
    const results = extractEmbeddedExpressions(
      "PR #${ $context.pr } in ${ $context.repo }.",
    );
    expect(results).toHaveLength(2);
    expect(results[0].expr).toBe("$context.pr");
    expect(results[1].expr).toBe("$context.repo");
  });

  it("handles nested braces in jq object construction", () => {
    const results = extractEmbeddedExpressions(
      "Result: ${ { key: .value } }",
    );
    expect(results).toHaveLength(1);
    expect(results[0].expr).toBe("{ key: .value }");
  });

  it("returns empty array for strict expressions", () => {
    expect(extractEmbeddedExpressions("${ .name }")).toEqual([]);
  });

  it("returns empty array for strings without expressions", () => {
    expect(extractEmbeddedExpressions("plain text")).toEqual([]);
    expect(extractEmbeddedExpressions("")).toEqual([]);
  });

  it("skips runtime placeholders (no space after ${)", () => {
    const results = extractEmbeddedExpressions(
      "Bearer ${.secrets.TOKEN} and ${ .name }",
    );
    expect(results).toHaveLength(1);
    expect(results[0].expr).toBe(".name");
  });

  it("handles expression at the start of the string", () => {
    const results = extractEmbeddedExpressions("${ .greeting } world");
    expect(results).toHaveLength(1);
    expect(results[0].expr).toBe(".greeting");
  });

  it("handles expression at the end of the string", () => {
    const results = extractEmbeddedExpressions("Hello ${ .name }");
    expect(results).toHaveLength(1);
    expect(results[0].expr).toBe(".name");
  });

  it("handles multi-line strings with expressions", () => {
    const multiline = "Generate report.\nDate: ${ $env.DATE }\nSource: database";
    const results = extractEmbeddedExpressions(multiline);
    expect(results).toHaveLength(1);
    expect(results[0].expr).toBe("$env.DATE");
  });

  it("handles unclosed brace gracefully (skips it)", () => {
    const results = extractEmbeddedExpressions("broken ${ .unclosed");
    expect(results).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// hasEmbeddedExpressions
// ─────────────────────────────────────────────────────────────────────

describe("hasEmbeddedExpressions", () => {
  it("returns true for strings with embedded expressions", () => {
    expect(hasEmbeddedExpressions("Hello ${ .name }!")).toBe(true);
  });

  it("returns false for strict expressions", () => {
    expect(hasEmbeddedExpressions("${ .name }")).toBe(false);
  });

  it("returns false for plain strings", () => {
    expect(hasEmbeddedExpressions("plain text")).toBe(false);
  });

  it("returns false for runtime placeholders", () => {
    expect(hasEmbeddedExpressions("${.secrets.KEY}")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// stringifyInterpolatedValue
// ─────────────────────────────────────────────────────────────────────

describe("stringifyInterpolatedValue", () => {
  it("converts null to empty string", () => {
    expect(stringifyInterpolatedValue(null)).toBe("");
  });

  it("converts undefined to empty string", () => {
    expect(stringifyInterpolatedValue(undefined)).toBe("");
  });

  it("returns strings directly", () => {
    expect(stringifyInterpolatedValue("hello")).toBe("hello");
  });

  it("JSON-stringifies numbers", () => {
    expect(stringifyInterpolatedValue(42)).toBe("42");
  });

  it("JSON-stringifies booleans", () => {
    expect(stringifyInterpolatedValue(true)).toBe("true");
  });

  it("JSON-stringifies objects", () => {
    expect(stringifyInterpolatedValue({ a: 1 })).toBe('{"a":1}');
  });

  it("JSON-stringifies arrays", () => {
    expect(stringifyInterpolatedValue([1, 2])).toBe("[1,2]");
  });
});

// ─────────────────────────────────────────────────────────────────────
// interpolateString
// ─────────────────────────────────────────────────────────────────────

describe("interpolateString", () => {
  it("resolves a single embedded expression", async () => {
    const result = await interpolateString(
      "Hello ${ .name }!",
      { name: "Alice" },
      {},
    );
    expect(result).toBe("Hello Alice!");
  });

  it("resolves multiple embedded expressions", async () => {
    const stateVars = {
      $context: { task: { count: 3 } },
      $env: { REGION: "us-east" },
    };
    const result = await interpolateString(
      "Found ${ $context.task.count } items in ${ $env.REGION }.",
      null,
      stateVars,
    );
    expect(result).toBe("Found 3 items in us-east.");
  });

  it("converts null expression results to empty string", async () => {
    const stateVars = { $env: {} };
    const result = await interpolateString(
      "Date: ${ $env.MISSING_VAR }",
      null,
      stateVars,
    );
    expect(result).toBe("Date: ");
  });

  it("JSON-stringifies object results in embedded context", async () => {
    const stateVars = { $context: { data: { key: "val" } } };
    const result = await interpolateString(
      "Data: ${ $context.data }",
      null,
      stateVars,
    );
    expect(result).toBe('Data: {"key":"val"}');
  });

  it("returns string unchanged when no expressions present", async () => {
    const result = await interpolateString("no expressions here", {}, {});
    expect(result).toBe("no expressions here");
  });

  it("preserves runtime placeholders (different syntax)", async () => {
    const result = await interpolateString(
      "token=${.secrets.KEY} and ${ .name }",
      { name: "test" },
      {},
    );
    expect(result).toBe("token=${.secrets.KEY} and test");
  });
});

// ─────────────────────────────────────────────────────────────────────
// evaluateString — updated behavior with embedded expressions
// ─────────────────────────────────────────────────────────────────────

describe("evaluateString — embedded expression support", () => {
  it("still evaluates strict expressions and returns non-string types", async () => {
    const result = await evaluateString("${ .count }", { count: 42 }, {});
    expect(result).toBe(42);
    expect(typeof result).toBe("number");
  });

  it("interpolates embedded expressions and returns a string", async () => {
    const result = await evaluateString(
      "Count is ${ .count }",
      { count: 42 },
      {},
    );
    expect(result).toBe("Count is 42");
    expect(typeof result).toBe("string");
  });

  it("returns plain strings as-is", async () => {
    const result = await evaluateString("plain text", {}, {});
    expect(result).toBe("plain text");
  });

  it("handles multi-line template with $env and $context", async () => {
    const stateVars = {
      $env: { DATE: "2026-05-23" },
      $context: { task: { summary: "All good" } },
    };
    const result = await evaluateString(
      "Report for ${ $env.DATE }.\nSummary: ${ $context.task.summary }",
      null,
      stateVars,
    );
    expect(result).toBe("Report for 2026-05-23.\nSummary: All good");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Single-Quote Normalization (Layer 0: pure function tests)
// ─────────────────────────────────────────────────────────────────────

describe("normalizeSingleQuotedStrings", () => {
  it("converts a simple single-quoted string", () => {
    expect(normalizeSingleQuotedStrings("$context.x == 'approve'"))
      .toBe('$context.x == "approve"');
  });

  it("converts the production bug expression", () => {
    expect(normalizeSingleQuotedStrings(
      "$context.team_lead_review.outcome == 'approve'",
    )).toBe('$context.team_lead_review.outcome == "approve"');
  });

  it("converts an empty single-quoted string", () => {
    expect(normalizeSingleQuotedStrings("$context.x == ''"))
      .toBe('$context.x == ""');
  });

  it("converts multiple single-quoted literals", () => {
    expect(normalizeSingleQuotedStrings("'a' == 'b'"))
      .toBe('"a" == "b"');
  });

  it("only converts singles, leaves doubles unchanged", () => {
    expect(normalizeSingleQuotedStrings('$context.x == \'y\' and .z == "w"'))
      .toBe('$context.x == "y" and .z == "w"');
  });

  it("escapes double quotes inside single-quoted strings", () => {
    expect(normalizeSingleQuotedStrings("$context.x == 'he said \"hi\"'"))
      .toBe('$context.x == "he said \\"hi\\""');
  });

  it("escapes backslashes inside single-quoted strings", () => {
    expect(normalizeSingleQuotedStrings("$context.x == 'path\\to'"))
      .toBe('$context.x == "path\\\\to"');
  });

  it("does not convert single quotes inside double-quoted strings", () => {
    const expr = '"it\'s a test"';
    expect(normalizeSingleQuotedStrings(expr)).toBe(expr);
  });

  it("is a no-op when no single quotes are present", () => {
    expect(normalizeSingleQuotedStrings("$context.x > 5"))
      .toBe("$context.x > 5");
  });

  it("converts strings with special characters", () => {
    expect(normalizeSingleQuotedStrings("$context.x == 'in-progress'"))
      .toBe('$context.x == "in-progress"');
  });

  it("passes through unclosed single quotes unchanged", () => {
    const expr = "$context.x == 'broken";
    expect(normalizeSingleQuotedStrings(expr)).toBe(expr);
  });

  it("handles jq comment lines without converting quotes", () => {
    expect(normalizeSingleQuotedStrings("# it's a test"))
      .toBe("# it's a test");
  });

  it("handles adjacent single-quoted strings", () => {
    expect(normalizeSingleQuotedStrings("'hello' + ' ' + 'world'"))
      .toBe('"hello" + " " + "world"');
  });

  it("handles strings with dots and versions", () => {
    expect(normalizeSingleQuotedStrings("$context.ver == 'v1.2.3'"))
      .toBe('$context.ver == "v1.2.3"');
  });

  it("handles expressions with no quotes at all", () => {
    const expr = "$context.count > 5 and $data.valid == true";
    expect(normalizeSingleQuotedStrings(expr)).toBe(expr);
  });

  it("handles escaped backslash inside double-quoted string followed by single", () => {
    expect(normalizeSingleQuotedStrings('"escaped\\\\" + \'val\''))
      .toBe('"escaped\\\\" + "val"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// String Comparison via evaluateExpression (Layer 1: end-to-end jq-wasm)
// ─────────────────────────────────────────────────────────────────────

describe("evaluateExpression — single-quoted string comparisons", () => {
  const stateVars = {
    $context: {
      outcome: "approve",
      status: "in-progress",
      team_lead_review: { outcome: "approve", reviewer: "alice" },
    },
    $data: {},
    $env: {},
    $input: null,
    $output: null,
  };

  it("evaluates single-quoted string equality (true)", async () => {
    const result = await evaluateExpression(
      "$context.outcome == 'approve'", null, stateVars,
    );
    expect(result).toBe(true);
  });

  it("evaluates double-quoted string equality (true)", async () => {
    const result = await evaluateExpression(
      '$context.outcome == "approve"', null, stateVars,
    );
    expect(result).toBe(true);
  });

  it("evaluates single-quoted string equality (false)", async () => {
    const result = await evaluateExpression(
      "$context.outcome == 'reject'", null, stateVars,
    );
    expect(result).toBe(false);
  });

  it("evaluates special-char string comparison", async () => {
    const result = await evaluateExpression(
      "$context.status == 'in-progress'", null, stateVars,
    );
    expect(result).toBe(true);
  });

  it("evaluates nested context path with single-quoted comparison", async () => {
    const result = await evaluateExpression(
      "$context.team_lead_review.outcome == 'approve'", null, stateVars,
    );
    expect(result).toBe(true);
  });

  it("evaluates null-safe check with single-quoted string", async () => {
    const result = await evaluateExpression(
      "$context.outcome != null and $context.outcome == 'approve'",
      null, stateVars,
    );
    expect(result).toBe(true);
  });

  it("evaluates jq if-then-else with single-quoted strings", async () => {
    const result = await evaluateExpression(
      'if $context.outcome == \'approve\' then "yes" else "no" end',
      null, stateVars,
    );
    expect(result).toBe("yes");
  });

  it("evaluates mixed single and double quotes in one expression", async () => {
    const result = await evaluateExpression(
      '$context.outcome == \'approve\' and $context.status == "in-progress"',
      null, stateVars,
    );
    expect(result).toBe(true);
  });
});
