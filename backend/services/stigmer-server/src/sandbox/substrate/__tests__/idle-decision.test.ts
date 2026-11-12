/**
 * Pins the idle ladder's decision (idle-decision.ts) as a table: busy is
 * never touched; RUNNING suspends at the window; every other state is left
 * alone. On a draining worker, RUNNING is stored (suspended durably) as
 * soon as it is not busy, whatever its window, and once the drain deadline
 * has passed even while busy; every other state is still left alone.
 */
import { describe, expect, it } from "vitest";

import type { SubstrateSandboxState } from "../driver.js";
import { decideIdle, type IdleAction } from "../idle-decision.js";
import { DRAIN_DEADLINE_MS } from "../limits.js";

const now = new Date("2026-10-03T12:00:00Z");
const minutes = (n: number) => new Date(now.getTime() - n * 60_000);

describe("decideIdle", () => {
  const cases: Array<
    [string, SubstrateSandboxState, boolean, number, IdleAction]
  > = [
    ["busy and long idle", "running", true, 600, "none"],
    ["running, under the window", "running", false, 4, "none"],
    ["running, at the window", "running", false, 5, "suspend"],
    ["running, long past the window", "running", false, 45, "suspend"],
    ["suspending", "suspending", false, 600, "none"],
    ["suspended", "suspended", false, 600, "none"],
    ["resuming", "resuming", false, 600, "none"],
    ["crashed", "crashed", false, 600, "none"],
    ["deleting", "deleting", false, 600, "none"],
  ];
  it.each(cases)("%s", (_name, state, busy, idleMinutes, expected) => {
    expect(
      decideIdle({
        state,
        busy,
        lastActiveAt: minutes(idleMinutes),
        now,
        suspendAfterMs: 5 * 60_000,
      }),
    ).toBe(expected);
  });
});

describe("decideIdle on a draining worker", () => {
  const cases: Array<
    [string, SubstrateSandboxState, boolean, number, number, IdleAction]
  > = [
    // [name, state, busy, idle minutes, minutes since the drain was first seen, action]
    ["idle, just active: stored at once", "running", false, 0, 0, "store"],
    ["idle, past the window", "running", false, 45, 1, "store"],
    ["busy, under the deadline", "running", true, 0, 19, "none"],
    ["busy, at the deadline", "running", true, 0, 20, "store"],
    ["busy, long past the deadline", "running", true, 0, 29, "store"],
    ["suspending", "suspending", false, 600, 25, "none"],
    ["suspended", "suspended", false, 600, 25, "none"],
    ["resuming", "resuming", false, 600, 25, "none"],
    ["crashed", "crashed", false, 600, 25, "none"],
  ];
  it.each(cases)(
    "%s",
    (_name, state, busy, idleMinutes, drainMinutes, expected) => {
      expect(
        decideIdle({
          state,
          busy,
          lastActiveAt: minutes(idleMinutes),
          now,
          suspendAfterMs: 5 * 60_000,
          drainingSince: minutes(drainMinutes),
        }),
      ).toBe(expected);
    },
  );

  it("forces the store twenty minutes after the drain was first seen, inside Substrate's thirty", () => {
    expect(DRAIN_DEADLINE_MS).toBe(20 * 60_000);
  });
});
