/**
 * Pins the journey's two next lines. Under a finished turn
 * (`JourneyNextLine`): drawn only for a journey agent's session while "Make
 * it yours" is the step to take, with one act to the agent's tab; nothing
 * for another agent (whose journey is never read), before the journey is
 * known, once the step is done, or without the host's destination. Under
 * the launcher's heading (`JourneyLauncherLine`): from step 4 on, the step
 * in words with its destination ("Next: make Variance Reporter yours"),
 * nothing for the earlier steps, a destination the host does not pass, or a
 * launcher that does not ask. The journey is stubbed; `useJourney`'s suite
 * pins how it is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { JourneyStepId, UseJourneyReturn } from "../useJourney";

const state = vi.hoisted(() => ({
  status: "ready" as "ready" | "pending" | "off",
  done: 3,
  asked: [] as Array<{ org: unknown; enabled: boolean }>,
}));

const IDS: readonly JourneyStepId[] = ["describe", "key", "watch", "make-yours", "in-app", "others"];

vi.mock("../useJourney.js", () => ({
  useJourney: (org: unknown, options: { enabled: boolean }): UseJourneyReturn => {
    state.asked.push({ org, enabled: options.enabled });
    if (!options.enabled || state.status !== "ready") {
      return { status: options.enabled ? state.status : "off", steps: [], done: 0, current: undefined, agent: undefined };
    }
    const steps = IDS.map((id, index) => ({
      id,
      number: index + 1,
      title: id,
      state: index < state.done ? ("done" as const) : index === state.done ? ("current" as const) : ("todo" as const),
      line: id,
    }));
    return {
      status: "ready",
      steps,
      done: state.done,
      current: steps[state.done],
      agent: { ref: { org: "org_acme", slug: "variance-reporter" }, name: "Variance Reporter" },
    };
  },
}));

import { JourneyLauncherLine, JourneyNextLine } from "../JourneyNextLine";

const LINKS = {
  makeItYours: (agent: { org: string; slug: string }) => `/agents/${agent.org}/${agent.slug}?tab=make-it-yours`,
  putInApp: (agent: { org: string; slug: string }) => `/agents/${agent.org}/${agent.slug}?tab=channels`,
  bringOthers: "/settings/members",
};
const REPORTER = { org: "org_acme", slug: "variance-reporter" };

beforeEach(() => {
  state.status = "ready";
  state.done = 3;
  state.asked = [];
});
afterEach(cleanup);

describe("JourneyNextLine", () => {
  it("says what the first job did and leads to making the agent yours", () => {
    render(<JourneyNextLine org="org_acme" agentRef={REPORTER} links={LINKS} />);

    const line = screen.getByRole("status");
    expect(line.textContent).toContain("Your first agent did a job.");
    expect(line.textContent).toContain("Next: make it yours, with your own file or your own rules.");
    expect(screen.getByRole("link", { name: "Make it yours" }).getAttribute("href")).toBe("/agents/org_acme/variance-reporter?tab=make-it-yours");
  });

  it("links the session's own agent, as the session names it", () => {
    render(<JourneyNextLine org="org_acme" agentRef={{ org: "org_acme", slug: "your-agent-2" }} links={LINKS} />);

    expect(screen.getByRole("link", { name: "Make it yours" }).getAttribute("href")).toBe("/agents/org_acme/your-agent-2?tab=make-it-yours");
  });

  it("draws nothing for an agent the journey did not make, and reads no journey for it", () => {
    const { container } = render(<JourneyNextLine org="org_acme" agentRef={{ org: "org_acme", slug: "triage-bot" }} links={LINKS} />);

    expect(container.innerHTML).toBe("");
    expect(state.asked.every((asked) => !asked.enabled)).toBe(true);
  });

  it("draws nothing for the built-in assistant", () => {
    const { container } = render(<JourneyNextLine org="org_acme" agentRef={undefined} links={LINKS} />);
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing before the journey is known, or once Make it yours is done", () => {
    state.status = "pending";
    const { container, unmount } = render(<JourneyNextLine org="org_acme" agentRef={REPORTER} links={LINKS} />);
    expect(container.innerHTML).toBe("");
    unmount();

    state.status = "ready";
    state.done = 4;
    const after = render(<JourneyNextLine org="org_acme" agentRef={REPORTER} links={LINKS} />);
    expect(after.container.innerHTML).toBe("");
  });

  it("draws nothing without the host's destination", () => {
    const { container } = render(<JourneyNextLine org="org_acme" agentRef={REPORTER} links={{}} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("JourneyLauncherLine", () => {
  it.each([
    [3, "make Variance Reporter yours", "/agents/org_acme/variance-reporter?tab=make-it-yours"],
    [4, "put Variance Reporter in your app", "/agents/org_acme/variance-reporter?tab=channels"],
    [5, "bring your team in", "/settings/members"],
  ])("names step %i as the next one, with its destination", (done, words, href) => {
    state.done = done;
    render(<JourneyLauncherLine org="org_acme" links={LINKS} enabled />);

    expect(screen.getByRole("status").textContent).toBe(`Next:${words}`);
    expect(screen.getByRole("link", { name: words }).getAttribute("href")).toBe(href);
  });

  it("says nothing for the first three steps, which the launcher itself leads", () => {
    for (const done of [0, 1, 2]) {
      state.done = done;
      const { container, unmount } = render(<JourneyLauncherLine org="org_acme" links={LINKS} enabled />);
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });

  it("says nothing when the launcher does not ask, or the host passes no destination", () => {
    const { container, unmount } = render(<JourneyLauncherLine org="org_acme" links={LINKS} enabled={false} />);
    expect(container.innerHTML).toBe("");
    expect(state.asked.every((asked) => !asked.enabled)).toBe(true);
    unmount();

    const bare = render(<JourneyLauncherLine org="org_acme" links={{}} enabled />);
    expect(bare.container.innerHTML).toBe("");
  });
});
