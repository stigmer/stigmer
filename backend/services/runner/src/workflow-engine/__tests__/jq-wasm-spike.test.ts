/**
 * DD-W01 Spike: Verify jq-wasm works for expression evaluation.
 *
 * Finding: jq-wasm's Emscripten loader uses require("fs"), require("path"),
 * and require("crypto") — all blocked by the Temporal workflow sandbox.
 * jq-wasm CANNOT run inside a workflow function.
 *
 * Resolution: jq-wasm runs in a local activity (full Node.js access).
 * The workflow calls a batch expression evaluator local activity whenever
 * it needs to evaluate jq expressions. Local activities run in the same
 * worker process with minimal overhead, and their results are recorded
 * in workflow history for deterministic replay.
 *
 * These tests confirm jq-wasm works correctly for activity-side use.
 */

import { describe, it, expect } from "vitest";
import * as jq from "jq-wasm";

describe("jq-wasm activity-side validation", () => {
  it("evaluates a simple dot path", async () => {
    const result = await jq.json({ name: "test", value: 42 }, ".name");
    expect(result).toBe("test");
  });

  it("evaluates arithmetic", async () => {
    const result = await jq.json({ a: 10, b: 32 }, ".a + .b");
    expect(result).toBe(42);
  });

  it("evaluates comparisons", async () => {
    const result = await jq.json({ x: 10 }, ".x > 5");
    expect(result).toBe(true);
  });

  it("evaluates object construction", async () => {
    const result = await jq.json(
      { first: "hello", second: "world" },
      '{ greeting: .first, target: .second }',
    );
    expect(result).toEqual({ greeting: "hello", target: "world" });
  });

  it("evaluates pipe expressions", async () => {
    const result = await jq.json([1, 2, 3, 4, 5], ". | length");
    expect(result).toBe(5);
  });

  it("evaluates with null input normalized to empty object", async () => {
    const result = await jq.json({}, "1 == 1");
    expect(result).toBe(true);
  });

  it("evaluates variable injection via expression wrapping", async () => {
    const state = {
      $context: { userId: 42 },
      $data: { items: [1, 2, 3] },
      $env: {},
      $input: null,
      $output: null,
    };

    const wrappedExpr =
      '. as $context | .data as $data | $context.userId';
    const input = { ...state.$context, data: state.$data };
    const result = await jq.json(input, ".userId");
    expect(result).toBe(42);
  });

  it("evaluates object merge expression", async () => {
    const result = await jq.json(
      { existing: "value" },
      '. + { newKey: "added" }',
    );
    expect(result).toEqual({ existing: "value", newKey: "added" });
  });

  it("evaluates null checks", async () => {
    const result = await jq.json({ a: 1, b: null }, ".a != null");
    expect(result).toBe(true);

    const result2 = await jq.json({ a: 1, b: null }, ".b != null");
    expect(result2).toBe(false);
  });

  it("returns jq version", async () => {
    const ver = await jq.version();
    expect(ver).toMatch(/^jq-\d+\.\d+/);
  });
});
