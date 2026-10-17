// Pins the schedule fire's deterministic failure copy in support/schedules.ts:
// a schedule holds its agent's id, and an agent deleted since has no name
// left, so the reason names the organization and the agent by id.
import { describe, expect, it } from "vitest";

import { targetMissingReason } from "../routines";

describe("targetMissingReason", () => {
  it("names the organization and the deleted agent's id", () => {
    expect(targetMissingReason("org_01acme", "agt_01gone")).toBe("target agent org_01acme/agt_01gone not found");
  });
});
