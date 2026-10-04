/**
 * The idle decision's table: a Running Sandbox whose session has been idle
 * for the window is suspended, at the boundary included; a busy session, a
 * Sandbox already Suspended and one being deleted never are.
 */
import { describe, expect, it } from "vitest";

import { shouldSuspend, type IdleInput } from "../idle-decision.js";

const window = 330_000;
const now = new Date("2026-10-04T12:00:00Z");
const idleFor = (ms: number): Date => new Date(now.getTime() - ms);

const base: IdleInput = {
  operatingMode: "Running",
  deleting: false,
  busy: false,
  lastActiveAt: idleFor(window),
  now,
  suspendAfterMs: window,
};

describe("shouldSuspend", () => {
  it.each<[string, Partial<IdleInput>, boolean]>([
    ["idle for exactly the window", {}, true],
    ["idle for longer", { lastActiveAt: idleFor(window * 10) }, true],
    [
      "idle for one millisecond less",
      { lastActiveAt: idleFor(window - 1) },
      false,
    ],
    ["active just now", { lastActiveAt: now }, false],
    [
      "busy, however long idle",
      { busy: true, lastActiveAt: idleFor(window * 10) },
      false,
    ],
    ["already Suspended", { operatingMode: "Suspended" }, false],
    ["being deleted", { deleting: true }, false],
  ])("%s → %s", (_name, change, expected) => {
    expect(shouldSuspend({ ...base, ...change })).toBe(expected);
  });
});
