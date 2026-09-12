/**
 * The stop controller: one signal for every cause, every cause recorded,
 * the first cause the abort's reason. The terminal table's precedence is
 * decided at settlement from the recorded evidence, not from which cause
 * aborted first.
 */

import { describe, expect, it } from "vitest";

import { StallTimeoutError } from "../../shared/stall-watchdog.js";
import { StopController } from "../stop-controller.js";

describe("StopController", () => {
  it("starts live with no evidence", () => {
    const stop = new StopController();
    expect(stop.signal.aborted).toBe(false);
    expect(stop.evidence).toEqual({ stall: undefined, costCapExceeded: false, platformStop: false, cancellation: false });
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
