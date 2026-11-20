/**
 * Pins the pure parts of a turn's wait for a sandbox (../sandbox-wait.ts):
 * the asks are 5 s apart at first and never more than 15 s apart, so a turn
 * takes room within 15 s of it appearing; a wait that ran out carries the
 * person's sentence with the limit in their units; a sandbox that cannot
 * be carried to the server's runner ends the turn with its own sentence
 * (stigmer#1843); a sandbox killed for its memory ends the turn with a
 * sentence that says so and what it means for the files (stigmer#3347);
 * and the wire constants (the patch ids, the kind, the
 * phase text) are the bytes histories and clients read.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SANDBOX_WAIT_SECONDS,
  SANDBOX_NOT_CARRIED_COPY,
  SANDBOX_NOT_CARRIED_PATCH_ID,
  SANDBOX_OUT_OF_MEMORY_COPY,
  SANDBOX_OUT_OF_MEMORY_PATCH_ID,
  SANDBOX_OUT_OF_MEMORY_STOP_CAUSE,
  SANDBOX_OUT_OF_MEMORY_STOP_KIND,
  SANDBOX_WAIT_PATCH_ID,
  SANDBOX_WAIT_STOP_CAUSE,
  SANDBOX_WAIT_STOP_KIND,
  SANDBOX_WAITING_PHASE_TEXT,
  SandboxNotCarried,
  SandboxOutOfMemory,
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
    expect(sandboxWaitRanOutCopy(150), "never longer than the wait: 2m 30s is 2 minutes").toContain("busy for 2 minutes,");
    expect(sandboxWaitRanOutCopy(119)).toContain("busy for 1 minute,");
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

  it("carries the person's sentence for a sandbox that cannot be carried, saying what happened and what to do", () => {
    const refused = new SandboxNotCarried();
    expect(refused.name).toBe("SandboxNotCarried");
    expect(refused.message).toBe(SANDBOX_NOT_CARRIED_COPY);
    expect(SANDBOX_NOT_CARRIED_COPY).toBe(
      "This conversation's sandbox was started by another Stigmer release and its files can't be moved to this one. Start a new conversation to continue.",
    );
  });

  it("carries the person's sentence for a sandbox that ran out of memory: what happened, why, and the files", () => {
    const killed = new SandboxOutOfMemory();
    expect(killed.name).toBe("SandboxOutOfMemory");
    expect(killed.message).toBe(SANDBOX_OUT_OF_MEMORY_COPY);
    expect(SANDBOX_OUT_OF_MEMORY_COPY).toBe(
      "The sandbox ran out of memory, so this turn stopped. A command needed more memory than this sandbox has. Its files went back to their last saved state, so recent changes may be gone.",
    );
  });

  it("keeps the bytes histories and clients read", () => {
    expect(SANDBOX_WAIT_PATCH_ID).toBe("ensure-sandbox-in-workflow");
    expect(SANDBOX_NOT_CARRIED_PATCH_ID).toBe("end-turn-on-sandbox-not-carried");
    expect(SANDBOX_OUT_OF_MEMORY_PATCH_ID).toBe("end-turn-on-sandbox-out-of-memory");
    expect([SANDBOX_OUT_OF_MEMORY_STOP_CAUSE, SANDBOX_OUT_OF_MEMORY_STOP_KIND]).toEqual(["failed", "sandbox_out_of_memory"]);
    expect([SANDBOX_WAIT_STOP_CAUSE, SANDBOX_WAIT_STOP_KIND]).toEqual(["infrastructure", "no_sandbox_room"]);
    expect(SANDBOX_WAITING_PHASE_TEXT).toBe("Waiting for a sandbox");
    expect(DEFAULT_SANDBOX_WAIT_SECONDS).toBe(900);
  });
});
