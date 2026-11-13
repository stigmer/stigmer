/**
 * Pins the pure parts of a turn's wait for a sandbox (../sandbox-wait.ts):
 * the asks are 5 s apart at first and never more than 15 s apart, so a turn
 * takes room within 15 s of it appearing; a wait that ran out carries the
 * person's sentence with the limit in their units; and the wire constants
 * (the patch id, the kind, the phase text) are the bytes histories and
 * clients read.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SANDBOX_WAIT_SECONDS,
  SANDBOX_WAIT_PATCH_ID,
  SANDBOX_WAIT_STOP_CAUSE,
  SANDBOX_WAIT_STOP_KIND,
  SANDBOX_WAITING_PHASE_TEXT,
  SandboxWaitRanOut,
  sandboxWaitBackoffMs,
  sandboxWaitRanOutCopy,
} from "../sandbox-wait.js";

describe("the wait for a sandbox with room", () => {
  it("asks again 5 s, then 10 s, then every 15 s", () => {
    expect([1, 2, 3, 4, 60].map(sandboxWaitBackoffMs)).toEqual([5_000, 10_000, 15_000, 15_000, 15_000]);
    expect(sandboxWaitBackoffMs(0), "a first ask never waits less than a step").toBe(5_000);
  });

  it("says how long every sandbox was busy, in the person's units", () => {
    expect(sandboxWaitRanOutCopy(DEFAULT_SANDBOX_WAIT_SECONDS)).toBe(
      "Every sandbox was busy for 15 minutes, so this turn didn't start. Nothing was lost: run it again to wait for room.",
    );
    expect(sandboxWaitRanOutCopy(60)).toContain("busy for 1 minute,");
    expect(sandboxWaitRanOutCopy(150)).toContain("busy for 3 minutes,");
    expect(sandboxWaitRanOutCopy(45)).toContain("busy for 45 seconds,");
    expect(sandboxWaitRanOutCopy(0)).toBe(
      "Every sandbox was busy, so this turn didn't start. Nothing was lost: run it again once one is free.",
    );
  });

  it("carries the limit and the wait in the error the failure write reads", () => {
    const ranOut = new SandboxWaitRanOut(120, 121_500);
    expect([ranOut.name, ranOut.limitSeconds, ranOut.waitedMs]).toEqual(["SandboxWaitRanOut", 120, 121_500]);
    expect(ranOut.message).toBe(sandboxWaitRanOutCopy(120));
  });

  it("keeps the bytes histories and clients read", () => {
    expect(SANDBOX_WAIT_PATCH_ID).toBe("ensure-sandbox-in-workflow");
    expect([SANDBOX_WAIT_STOP_CAUSE, SANDBOX_WAIT_STOP_KIND]).toEqual(["infrastructure", "no_sandbox_room"]);
    expect(SANDBOX_WAITING_PHASE_TEXT).toBe("Waiting for a sandbox");
    expect(DEFAULT_SANDBOX_WAIT_SECONDS).toBe(900);
  });
});
