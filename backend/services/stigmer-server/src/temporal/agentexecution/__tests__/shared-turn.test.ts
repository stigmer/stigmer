/**
 * Pins the pure parts of a shared turn's wait for a place
 * (../shared-turn.ts): a wait that ran out carries the person's sentence,
 * with the limit in their units (seconds below a minute, whole minutes
 * floored from a minute on, singular at one), and a zero limit says the
 * turn never waited; and the phase text is the bytes clients read.
 */
import { describe, expect, it } from "vitest";

import { SHARED_WAITING_PHASE_TEXT, sharedWaitRanOutCopy } from "../shared-turn.js";

describe("the wait for a place on a shared runner", () => {
  it("says the turn never waited when the limit is zero or below", () => {
    const never =
      "Your organization was already running as many agents as it may at once, so this turn didn't start. Nothing was lost: run it again once one finishes.";
    expect(sharedWaitRanOutCopy(0)).toBe(never);
    expect(sharedWaitRanOutCopy(-5)).toBe(never);
  });

  it("says how long every place was taken, in the person's units", () => {
    const copy = (length: string): string =>
      `Your organization was running as many agents as it may at once for ${length}, so this turn didn't start. Nothing was lost: run it again to wait for room.`;
    expect(sharedWaitRanOutCopy(1)).toBe(copy("1 second"));
    expect(sharedWaitRanOutCopy(45)).toBe(copy("45 seconds"));
    expect(sharedWaitRanOutCopy(60)).toBe(copy("1 minute"));
    expect(sharedWaitRanOutCopy(119)).toBe(copy("1 minute"));
    expect(sharedWaitRanOutCopy(900)).toBe(copy("15 minutes"));
    expect(sharedWaitRanOutCopy(959)).toBe(copy("15 minutes"));
  });

  it("names the phase a waiting turn shows", () => {
    expect(SHARED_WAITING_PHASE_TEXT).toBe("Waiting for room to run");
  });
});
