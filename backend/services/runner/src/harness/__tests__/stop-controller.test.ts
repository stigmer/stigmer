/**
 * The stop controller: one signal for every cause, every cause recorded,
 * the first cause the abort's reason. The terminal table's precedence is
 * decided at settlement from the recorded evidence, not from which cause
 * aborted first. A plugin-eval mock's stop is one more cause, and its arm
 * writes the sentence the eval reads back.
 */

import { describe, expect, it } from "vitest";

import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { parseTryStop } from "@stigmer/eval-runtime";

import { StallTimeoutError } from "../../shared/stall-watchdog.js";
import { StopController } from "../stop-controller.js";
import { mockAbortArm } from "../terminal-table.js";

describe("StopController", () => {
  it("starts live with no evidence", () => {
    const stop = new StopController();
    expect(stop.signal.aborted).toBe(false);
    expect(stop.evidence).toEqual({
      stall: undefined,
      mockAbort: undefined,
      costCapExceeded: false,
      platformStop: false,
      cancellation: false,
    });
  });

  it("the first cause aborts the signal and names the abort; later causes are recorded but do not re-abort", () => {
    const stop = new StopController();
    stop.stop({ kind: "cost-cap" });
    expect(stop.signal.aborted).toBe(true);
    expect(stop.signal.reason).toBe("cost-cap");

    stop.stop({ kind: "cancellation" });
    stop.stop({ kind: "platform-stop" });
    expect(stop.signal.reason, "the abort keeps its first reason").toBe("cost-cap");
    expect(stop.evidence).toMatchObject({ costCapExceeded: true, cancellation: true, platformStop: true });
  });

  it("keeps the FIRST stall error when the watchdog reports twice", () => {
    const stop = new StopController();
    const first = new StallTimeoutError(3_000, "last tool: shell");
    stop.stop({ kind: "stall", error: first });
    stop.stop({ kind: "stall", error: new StallTimeoutError(9_000) });
    expect(stop.evidence.stall).toBe(first);
  });

  it("fires abort listeners exactly once", () => {
    const stop = new StopController();
    let fired = 0;
    stop.signal.addEventListener("abort", () => fired++);
    stop.stop({ kind: "cancellation" });
    stop.stop({ kind: "cancellation" });
    stop.stop({ kind: "cost-cap" });
    expect(fired).toBe(1);
  });
});

describe("a plugin-eval mock's stop", () => {
  it("records the first mock's abort beside the other causes", () => {
    const stop = new StopController();
    stop.stop({ kind: "mock-abort", abort: { server: "tracker", tool: "create_issue", reason: "input.title must be a string" } });
    stop.stop({ kind: "mock-abort", abort: { server: "tracker", tool: "other", reason: "later" } });
    stop.stop({ kind: "cost-cap" });
    expect(stop.signal.reason).toBe("mock-abort");
    expect(stop.evidence).toMatchObject({
      mockAbort: { server: "tracker", tool: "create_issue", reason: "input.title must be a string" },
      costCapExceeded: true,
    });
  });

  it("ends the try TERMINATED with the sentence the eval reads back", () => {
    const arm = mockAbortArm({ server: "tracker", tool: "create_issue", reason: "input.title must be a string" });
    expect(arm.phase).toBe(RunPhase.RUN_TERMINATED);
    expect(parseTryStop(arm.error ?? "")).toEqual({
      kind: "mock-aborted",
      server: "tracker",
      tool: "create_issue",
      reason: "input.title must be a string",
    });
    expect(arm.rows).toEqual(["A mock stopped this run: tracker.create_issue: input.title must be a string"]);
  });
});
