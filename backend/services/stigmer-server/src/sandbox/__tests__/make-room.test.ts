/**
 * Pins which idle sandbox yields its seat to a waiting run
 * (make-room.ts `orderSandboxesToFree`) as a table: longest idle first;
 * busy never; on a leaving worker never; plain idle before parked, and a
 * parked one still chosen when nothing else is; ties by id, so two server
 * replicas choose alike; at most MAKE_ROOM_MAX_TRIES offered; nothing in,
 * nothing out. And the retry schedule after room is made stays a few
 * seconds, inside the ask's heartbeat.
 */
import { describe, expect, it } from "vitest";

import {
  MAKE_ROOM_MAX_TRIES,
  MAKE_ROOM_RETRY_DELAYS_MS,
  orderSandboxesToFree,
  type MakeRoomCandidate,
} from "../make-room.js";

const now = Date.parse("2026-11-20T12:00:00Z");

/** A candidate idle for `idleMinutes`, plain idle unless told otherwise. */
function sandbox(
  id: string,
  idleMinutes: number,
  facts: Partial<Pick<MakeRoomCandidate, "busy" | "parked" | "draining">> = {},
): MakeRoomCandidate {
  return {
    id,
    busy: facts.busy ?? false,
    parked: facts.parked ?? false,
    draining: facts.draining ?? false,
    lastActiveAt: new Date(now - idleMinutes * 60_000),
  };
}

describe("orderSandboxesToFree", () => {
  const cases: Array<[string, MakeRoomCandidate[], string[]]> = [
    ["nothing in, nothing out", [], []],
    [
      "longest idle first",
      [sandbox("ses_a", 1), sandbox("ses_b", 30), sandbox("ses_c", 5)],
      ["ses_b", "ses_c", "ses_a"],
    ],
    [
      "a busy sandbox never, however long its clock says it has been idle",
      [sandbox("ses_working", 600, { busy: true }), sandbox("ses_idle", 1)],
      ["ses_idle"],
    ],
    ["only busy sandboxes: none", [sandbox("ses_a", 60, { busy: true }), sandbox("ses_b", 9, { busy: true })], []],
    [
      "never one on a leaving worker (its sweep stores it durably)",
      [sandbox("ses_leaving", 600, { draining: true }), sandbox("ses_idle", 1)],
      ["ses_idle"],
    ],
    [
      "plain idle before parked, even when the parked one looks idler",
      [sandbox("ses_parked", 600, { parked: true }), sandbox("ses_idle", 1)],
      ["ses_idle", "ses_parked"],
    ],
    [
      "a parked one is still chosen when nothing else is",
      [sandbox("ses_parked", 2, { parked: true }), sandbox("ses_busy", 60, { busy: true })],
      ["ses_parked"],
    ],
    [
      "parked ones among themselves, longest idle first",
      [sandbox("ses_p1", 2, { parked: true }), sandbox("ses_p2", 20, { parked: true })],
      ["ses_p2", "ses_p1"],
    ],
    [
      "ties by id, so two replicas choose alike",
      [sandbox("ses_b", 5), sandbox("ses_c", 5), sandbox("ses_a", 5)],
      ["ses_a", "ses_b", "ses_c"],
    ],
    [
      "at most three offered",
      [sandbox("ses_a", 1), sandbox("ses_b", 2), sandbox("ses_c", 3), sandbox("ses_d", 4), sandbox("ses_e", 5)],
      ["ses_e", "ses_d", "ses_c"],
    ],
  ];
  it.each(cases)("%s", (_name, candidates, expected) => {
    expect(orderSandboxesToFree(candidates)).toEqual(expected);
  });

  it("offers three at most, and leaves the caller's list as it was", () => {
    expect(MAKE_ROOM_MAX_TRIES).toBe(3);
    const candidates = [sandbox("ses_a", 1), sandbox("ses_b", 2)];
    orderSandboxesToFree(candidates);
    expect(candidates.map((c) => c.id)).toEqual(["ses_a", "ses_b"]);
  });

  it("asks again three times over a few seconds once room is made, well inside the ask's 30 s heartbeat", () => {
    expect(MAKE_ROOM_RETRY_DELAYS_MS).toHaveLength(3);
    const total = MAKE_ROOM_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(5_000);
  });
});
