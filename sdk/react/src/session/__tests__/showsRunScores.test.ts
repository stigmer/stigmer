/**
 * Pins who sees run scores, by audience: the Console's people and a
 * conversation's reviewers do; an embedded end user and a share-link
 * visitor do not (the server admits no rating from either).
 */
import { describe, expect, it } from "vitest";
import { showsRunScores } from "../audience";

describe("showsRunScores", () => {
  it.each([
    ["integrator", true],
    ["observer", true],
    ["endUser", false],
    ["guest", false],
  ] as const)("%s → %s", (audience, shows) => {
    expect(showsRunScores(audience)).toBe(shows);
  });
});
