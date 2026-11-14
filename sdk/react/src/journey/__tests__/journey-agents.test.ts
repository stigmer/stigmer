/**
 * Pins which agents the journey made: every example's agent slug from
 * `@stigmer/examples`, and the names the first question tries for an agent
 * described in the person's own words (`your-agent`, then `your-agent-2` up
 * to its tries); nothing else, so a plugin's or another agent never counts.
 */
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "@stigmer/examples";
import { OWN_AGENT_TRIES, isJourneyAgentSlug, isOwnAgentSlug, ownAgentSlug } from "@stigmer/examples/journey";

describe("journey agents", () => {
  it("counts every example's agent", () => {
    for (const example of EXAMPLES) expect(isJourneyAgentSlug(example.agent.slug)).toBe(true);
  });

  it("counts every name the first question tries for an agent in the person's own words, and no other", () => {
    for (let n = 1; n <= OWN_AGENT_TRIES; n++) expect(isOwnAgentSlug(ownAgentSlug(n))).toBe(true);
    expect(ownAgentSlug(1)).toBe("your-agent");
    expect(ownAgentSlug(2)).toBe("your-agent-2");
    for (const slug of ["your-agent-1", "your-agent-02", `your-agent-${OWN_AGENT_TRIES + 1}`, "your-agents", "my-agent"]) {
      expect(isOwnAgentSlug(slug)).toBe(false);
    }
  });

  it("counts no other agent", () => {
    for (const slug of ["triage-bot", "variance-reporter-2", "linear-helper"]) expect(isJourneyAgentSlug(slug)).toBe(false);
  });
});
