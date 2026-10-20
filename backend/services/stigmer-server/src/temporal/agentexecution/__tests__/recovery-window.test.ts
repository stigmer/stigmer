/**
 * Pins the invoke workflow's recovery window (`../recovery-window.ts`): a
 * recovery counts while it is within the last hour, so ten inside an hour
 * reach the bound and ten spread over hours never do. The workflow's own
 * use of it, behind its patch, is pinned by the replay histories.
 */
import { describe, expect, it } from "vitest";

import { countRecovery, RECOVERY_WINDOW_MS } from "../recovery-window.js";

const MINUTE = 60_000;

describe("countRecovery", () => {
  it("counts every recovery inside one hour, this one included", () => {
    const instants: number[] = [];
    const counts = Array.from({ length: 11 }, (_, i) => countRecovery(instants, i * MINUTE));
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("forgets a recovery once it is more than an hour old", () => {
    const instants: number[] = [];
    countRecovery(instants, 0);
    countRecovery(instants, 30 * MINUTE);
    expect(countRecovery(instants, RECOVERY_WINDOW_MS + 1)).toBe(2);
    expect(instants).toEqual([30 * MINUTE, RECOVERY_WINDOW_MS + 1]);
  });

  it("keeps a recovery exactly an hour old", () => {
    const instants: number[] = [];
    countRecovery(instants, 0);
    expect(countRecovery(instants, RECOVERY_WINDOW_MS)).toBe(2);
  });

  it("never reaches ten for a deploy every twenty minutes across three hours", () => {
    const instants: number[] = [];
    const counts = Array.from({ length: 10 }, (_, i) => countRecovery(instants, i * 20 * MINUTE));
    expect(Math.max(...counts)).toBe(4);
  });
});
