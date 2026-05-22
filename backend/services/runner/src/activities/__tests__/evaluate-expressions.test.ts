import { describe, it, expect } from "vitest";
import { createEvaluateExpressionsActivities } from "../evaluate-expressions.js";

const { EvaluateExpressions } = createEvaluateExpressionsActivities();

describe("EvaluateExpressions activity", () => {
  describe("basic expression evaluation", () => {
    it("evaluates dot path expressions", async () => {
      const results = await EvaluateExpressions(
        { name: ".name" },
        { name: "test" },
        {},
      );
      expect(results).toEqual({ name: "test" });
    });

    it("evaluates multiple expressions in a single batch", async () => {
      const results = await EvaluateExpressions(
        {
          sum: ".a + .b",
          check: ".x > 5",
          identity: ".",
        },
        { a: 10, b: 32, x: 10 },
        {},
      );

      expect(results).toEqual({
        sum: 42,
        check: true,
        identity: { a: 10, b: 32, x: 10 },
      });
    });

    it("returns empty map for empty input", async () => {
      const results = await EvaluateExpressions({}, null, {});
      expect(results).toEqual({});
    });
  });

  describe("state variable access", () => {
    it("evaluates expressions with $context variable", async () => {
      const stateVars = {
        $context: { userId: 42, org: "acme" },
        $data: {},
        $env: {},
        $input: null,
        $output: null,
      };

      const results = await EvaluateExpressions(
        { user: "$context.userId", org: "$context.org" },
        null,
        stateVars,
      );

      expect(results).toEqual({ user: 42, org: "acme" });
    });

    it("evaluates expressions with $data variable", async () => {
      const stateVars = {
        $context: null,
        $data: { items: [1, 2, 3] },
        $env: {},
        $input: null,
        $output: null,
      };

      const results = await EvaluateExpressions(
        { count: "$data.items | length" },
        null,
        stateVars,
      );

      expect(results).toEqual({ count: 3 });
    });
  });

  describe("uuid generation", () => {
    it("generates a UUID when expression contains uuid token", async () => {
      const results = await EvaluateExpressions(
        { id: "uuid" },
        null,
        {},
      );

      expect(results.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("generates different UUIDs for multiple uuid tokens", async () => {
      const results = await EvaluateExpressions(
        { id1: "uuid", id2: "uuid" },
        null,
        {},
      );

      expect(results.id1).toMatch(/^[0-9a-f-]{36}$/);
      expect(results.id2).toMatch(/^[0-9a-f-]{36}$/);
      expect(results.id1).not.toBe(results.id2);
    });
  });

  describe("error handling", () => {
    it("throws on invalid jq expression", async () => {
      await expect(
        EvaluateExpressions(
          { bad: ".[invalid syntax" },
          {},
          {},
        ),
      ).rejects.toThrow();
    });
  });
});
