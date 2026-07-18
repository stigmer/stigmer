import { describe, it, expect } from "vitest";
import { validateAction } from "../call-validate.js";
import { transformAction } from "../call-transform.js";

// Regression coverage for the `expr.includes is not a function` crash
// (workflow-execution-ux-parity upstream #7): rule expressions are
// deferred code that must reach this activity as jq strings — in either
// the strict `${ ... }` wrapper or the bare form — and be evaluated here
// against the validated data, never pre-resolved by the config resolver.

describe("validateAction — rule expressions", () => {
  // The exact shape of WF1 ux-linear-basics' check_order task after the
  // call-function builder resolves `input` and defers the rule.
  const checkOrderConfig = {
    input: {
      order_id: "ORD-2026-0716",
      customer: "Ada Lovelace",
      currency: "USD",
      line_count: 2,
      total: 150,
    },
    schema: {
      type: "object",
      required: ["order_id", "total", "line_count"],
      properties: {
        order_id: { type: "string" },
        total: { type: "number" },
        line_count: { type: "integer" },
      },
    },
    rules: [
      {
        name: "total_is_positive",
        expression: "${ .total > 0 }",
        message: "Order total must be positive",
      },
    ],
    on_fail: "VALIDATION_FAIL_RAISE",
  };

  it("evaluates a ${ }-wrapped rule against the validate input (WF1 check_order)", async () => {
    const result = await validateAction(checkOrderConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("evaluates a bare jq rule expression", async () => {
    const result = await validateAction({
      input: { total: 150 },
      rules: [{ name: "positive", expression: ".total > 0" }],
      on_fail: "VALIDATION_FAIL_WARN",
    });
    expect(result.valid).toBe(true);
  });

  it("reports the rule message when the predicate fails", async () => {
    const result = await validateAction({
      input: { total: -5 },
      rules: [
        {
          name: "total_is_positive",
          expression: "${ .total > 0 }",
          message: "Order total must be positive",
        },
      ],
      on_fail: "VALIDATION_FAIL_WARN",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { rule: "total_is_positive", message: "Order total must be positive" },
    ]);
  });

  it("turns a non-string expression into a named config error, not a TypeError", async () => {
    // The pre-fix failure mode: the resolver substituted the evaluated
    // boolean back into the rule. The guard must name the rule and the
    // expected shape instead of crashing in the jq engine.
    const result = await validateAction({
      input: { total: 150 },
      rules: [
        { name: "broken_rule", expression: true as unknown as string },
      ],
      on_fail: "VALIDATION_FAIL_WARN",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rule).toBe("broken_rule");
    expect(result.errors[0].message).toContain("expected a jq predicate string");
    expect(result.errors[0].message).toContain("boolean");
  });

  it("raises on failed rules when on_fail is RAISE", async () => {
    await expect(
      validateAction({
        input: { total: -5 },
        rules: [
          {
            name: "total_is_positive",
            expression: "${ .total > 0 }",
            message: "Order total must be positive",
          },
        ],
        on_fail: "VALIDATION_FAIL_RAISE",
      }),
    ).rejects.toThrow("Order total must be positive");
  });
});

describe("transformAction — deferred expression forms", () => {
  it("accepts a ${ }-wrapped expression", async () => {
    const result = await transformAction({
      engine: "TRANSFORM_ENGINE_JQ",
      expression: "${ { doubled: (.qty * 2) } }",
      input: { qty: 21 },
    });
    expect(result).toEqual({ doubled: 42 });
  });

  it("accepts the bare jq form the converter emits", async () => {
    const result = await transformAction({
      engine: "TRANSFORM_ENGINE_JQ",
      expression: "{ total: ([.items[] | .qty * .unit_price] | add) }",
      input: { items: [{ qty: 2, unit_price: 25.5 }, { qty: 1, unit_price: 99 }] },
    });
    expect(result).toEqual({ total: 150 });
  });

  it("rejects a non-string expression with a clear config error", async () => {
    await expect(
      transformAction({
        engine: "JQ",
        expression: { not: "a string" } as unknown as string,
        input: {},
      }),
    ).rejects.toThrow("must be a jq string");
  });
});
