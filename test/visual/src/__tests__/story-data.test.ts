// The walls picture's wiring (../scenes/story-data.ts): two customers of one
// product ask the same agent, and each conversation lives in that
// customer's own organization. The panel draws no organization, so no
// screenshot would notice the two conversations sharing one; this case does.
import { describe, expect, it } from "vitest";
import { JOB, OTHERS } from "../../../../brand/job-story.ts";
import { STORY_AGENT, wallsPanels } from "../scenes/story-data.ts";

describe("the walls picture's two conversations", () => {
  const panels = wallsPanels();
  const agent = STORY_AGENT.metadata!;

  it("are Northwind's and the second customer's, in that order", () => {
    expect(panels.map((panel) => panel.customer)).toEqual([JOB.customer, OTHERS.customer]);
  });

  it("live in two different organizations, each panel in its own conversation's", () => {
    const orgs = panels.map((panel) => panel.org);
    expect(new Set(orgs).size).toBe(2);
    for (const panel of panels) {
      expect(panel.replay.session?.metadata?.org, panel.customer).toBe(panel.org);
    }
  });

  it("are both with the integrator's one agent, which neither customer's organization holds", () => {
    for (const panel of panels) {
      expect(panel.agent, panel.customer).toBe(`${agent.org}/${agent.slug}`);
      expect(panel.replay.session?.spec?.agentRef, panel.customer).toMatchObject({ org: agent.org, slug: agent.slug });
      expect(panel.org, panel.customer).not.toBe(agent.org);
    }
  });

  it("share no session, turn or event, so each panel's calls are answered from its own", () => {
    const [first, second] = panels.map((panel) => panel.replay);
    expect(first!.session?.metadata?.id).not.toBe(second!.session?.metadata?.id);
    expect(first!.runs.map((run) => run.metadata?.id)).not.toEqual(second!.runs.map((run) => run.metadata?.id));
    for (const replay of [first!, second!]) {
      expect(replay.events.every((event) => event.sessionId === replay.session?.metadata?.id)).toBe(true);
      expect(replay.events.every((event) => event.runId === replay.runs[0]?.metadata?.id)).toBe(true);
    }
  });
});
