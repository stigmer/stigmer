// The known-gap mark's results (../known-gap.ts), pinned here as its twin
// pins them in backend/services/runner/src/__test-utils__/__tests__/known-gap.test.ts:
// a marked gap that still holds passes and says so in one line; a marked gap
// whose desired behaviour now passes fails with the ratchet's message; and a
// case where neither holds fails with both errors. With no gap, the desired
// assertions are the whole test.
// Domain: test support (shared assertions).
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnownGapClosedError, KnownGapUnexplainedError, expectKnownGap, type KnownGap } from "../known-gap.ts";

const ISSUE = "stigmer/stigmer#1";

function gap(holds: () => boolean): KnownGap {
  return { issue: ISSUE, today: { says: "the turn ends with the stall copy", holds } };
}

const failsDesired = (): void => {
  expect("stalled", "the turn completes").toBe("completed");
};

describe("expectKnownGap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes while the gap holds, and writes one line naming the issue and today's outcome", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expectKnownGap(gap(() => true), failsDesired);
    expect(log.mock.calls).toEqual([[`[known gap] ${ISSUE}: the turn ends with the stall copy`]]);
  });

  it("fails with the ratchet's message once the desired behaviour passes", async () => {
    await expect(expectKnownGap(gap(() => true), () => {})).rejects.toThrow(KnownGapClosedError);
    await expect(expectKnownGap(gap(() => true), async () => {})).rejects.toThrow(`${ISSUE} no longer holds here: remove the mark`);
  });

  it("fails with both errors when neither the desired behaviour nor today's outcome holds", async () => {
    const failed = expectKnownGap(gap(() => false), failsDesired);
    await expect(failed).rejects.toThrow(KnownGapUnexplainedError);
    await expect(expectKnownGap(gap(() => false), failsDesired)).rejects.toThrow(/the turn completes.*\n.*today: the check returned false/s);
  });

  it("names today's own error when its check throws", async () => {
    const throwing = gap(() => {
      throw new Error("no final status");
    });
    await expect(expectKnownGap(throwing, failsDesired)).rejects.toThrow(/today: no final status/);
  });

  it("is the desired assertions alone when no gap is given", async () => {
    await expect(expectKnownGap(undefined, failsDesired)).rejects.toThrow(/the turn completes/);
    await expect(expectKnownGap(undefined, () => {})).resolves.toBeUndefined();
  });
});
