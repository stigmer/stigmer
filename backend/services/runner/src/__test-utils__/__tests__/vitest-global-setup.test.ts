/**
 * Suite-gate tests (oss#257).
 *
 * The gate is what turns "three sqlite-importing files die at collection
 * with a raw ERR_UNKNOWN_BUILTIN_MODULE" into one immediate, actionable
 * failure. Both arms are pinned around an injected preflight (the
 * preflightNodeRuntime idiom), so the failure arm is testable on a
 * supported Node. The preflight MESSAGE contract itself is pinned in
 * __tests__/preflight.test.ts — here we pin only what the gate adds: the
 * throw/pass behavior and the test-context fix hint.
 */

import { describe, expect, it } from "vitest";
import { assertNodeCanRunSuite } from "../vitest-global-setup.js";

describe("assertNodeCanRunSuite", () => {
  it("returns cleanly when the preflight passes", () => {
    expect(() => assertNodeCanRunSuite(() => null)).not.toThrow();
  });

  it("throws the preflight diagnosis verbatim when it fails", () => {
    // The diagnosis must arrive unwrapped — it is the single source of what
    // is wrong (found version, missing capability, both floors).
    expect(() => assertNodeCanRunSuite(() => "diagnosis from preflight")).toThrow(
      /diagnosis from preflight/,
    );
  });

  it("appends the test-context fix hint", () => {
    // Both escape hatches: the repo's pinned Node, and the experimental flag
    // for Nodes where the builtin is flag-gated.
    expect(() => assertNodeCanRunSuite(() => "boom")).toThrow(/\.nvmrc/);
    expect(() => assertNodeCanRunSuite(() => "boom")).toThrow(
      /--experimental-sqlite/,
    );
  });
});
