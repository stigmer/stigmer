// The agent-hours refusal: read off the refusal's reason, never its copy,
// with what it names (a child organization's names no plan); rendered with
// the server's copy and, only where the organization can change its plan,
// a link to the plans, the host's or the default.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StigmerError } from "@stigmer/sdk";
import { AgentHoursNotice, agentHoursUsedUp } from "../AgentHoursNotice";
import { refusal } from "./fixtures";

afterEach(cleanup);

const COPY =
  "This organization has used the 10 agent hours its Free plan includes this month. New work resumes on 1 November, or move to a plan with more hours.";
const METADATA = { org: "acme", plan: "Free", included_hours: "10", resets_at: "2026-11-01T00:00:00.000Z" };
const REFUSAL = refusal(COPY, "AGENT_HOURS_USED_UP", METADATA);
const CHILD_REFUSAL = refusal(
  "This organization's parent has used the agent hours its plan includes this month. New work resumes on 1 November.",
  "AGENT_HOURS_USED_UP",
  { ...METADATA, plan: "" },
);

describe("agentHoursUsedUp", () => {
  it("reads the org, plan, hours and reset from the refusal's reason", () => {
    expect(agentHoursUsedUp(REFUSAL)).toEqual({
      org: "acme",
      plan: "Free",
      includedHours: "10",
      resetsAt: "2026-11-01T00:00:00.000Z",
    });
    expect(agentHoursUsedUp(refusal("x", "AGENT_HOURS_USED_UP", {}))).toEqual({
      org: "",
      plan: "",
      includedHours: "",
      resetsAt: "",
    });
  });

  it("is null for any other error, whatever its copy", () => {
    expect(agentHoursUsedUp(new StigmerError("failed-precondition", COPY, 9))).toBeNull();
    expect(agentHoursUsedUp(refusal(COPY, "PROVIDER_KEY_REQUIRED", { provider: "anthropic" }))).toBeNull();
    expect(agentHoursUsedUp(undefined)).toBeNull();
  });
});

describe("AgentHoursNotice", () => {
  it("shows the server's copy and links to the plans", () => {
    render(<AgentHoursNotice error={REFUSAL} />);
    expect(screen.getByRole("alert").textContent).toContain(COPY);
    expect(screen.getByRole("link", { name: "View plans" }).getAttribute("href")).toBe("/settings/billing");
  });

  it("links to the host's own route when given one", () => {
    render(<AgentHoursNotice error={REFUSAL} billingHref="/org/acme/billing" />);
    expect(screen.getByRole("link", { name: "View plans" }).getAttribute("href")).toBe("/org/acme/billing");
  });

  it("offers a child organization no plans: its hours are its parent's", () => {
    render(<AgentHoursNotice error={CHILD_REFUSAL} />);
    expect(screen.getByRole("alert").textContent).toContain("parent has used");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
