/**
 * Pins the HITL resume gate (../gate.ts): the turn may resume exactly when
 * none of its asks is open.
 */
import { describe, expect, it } from "vitest";

import { gateResolved } from "../gate.js";

describe("the HITL gate", () => {
  it("is resolved exactly when no ask is open", () => {
    expect(gateResolved(0)).toBe(true);
    expect(gateResolved(1)).toBe(false);
    expect(gateResolved(3)).toBe(false);
  });
});
