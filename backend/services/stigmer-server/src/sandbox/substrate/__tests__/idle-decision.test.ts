/**
 * Pins the idle ladder's decision (idle-decision.ts) as a table: busy is
 * never touched; RUNNING pauses at the pause window; PAUSED suspends at the
 * suspend window; RUNNING past the suspend window pauses first; every
 * other state is left alone.
 */
import { describe, expect, it } from "vitest";

import type { SubstrateSandboxState } from "../driver.js";
import { decideIdle, type IdleAction } from "../idle-decision.js";

const now = new Date("2026-10-03T12:00:00Z");
const minutes = (n: number) => new Date(now.getTime() - n * 60_000);

describe("decideIdle", () => {
  const cases: Array<
    [string, SubstrateSandboxState, boolean, number, IdleAction]
  > = [
    ["busy and long idle", "running", true, 600, "none"],
    ["busy and paused", "paused", true, 600, "none"],
    ["running, under the pause window", "running", false, 4, "none"],
    ["running, at the pause window", "running", false, 5, "pause"],
    ["running, past the suspend window", "running", false, 45, "pause"],
    ["paused, under the suspend window", "paused", false, 29, "none"],
    ["paused, at the suspend window", "paused", false, 30, "suspend"],
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
        pauseAfterMs: 5 * 60_000,
        suspendAfterMs: 30 * 60_000,
      }),
    ).toBe(expected);
  });
});
