/**
 * Pins the app's journey routes, as the web console's: "Make it yours" and
 * "Put it in your app" open the agent page on its tab, the team is invited
 * on the members page, and a launch opens the launcher on the agent with
 * its example and mode; an organization named by id is written as its
 * slug; each link is drawn with the router's `Link`, so the hash routes
 * hold.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("@stigmer/react-sdk", () => ({
  useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
}));

import { agentLaunchUrl, renderJourneyLink, useJourneyLinks } from "../journey-links";

const AGENT = { org: "org_acme", slug: "variance-reporter" };

function Location() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

describe("desktop journey links", () => {
  it("routes each later step, naming the organization by its slug", () => {
    const { result } = renderHook(() => useJourneyLinks());

    expect(result.current.makeItYours?.(AGENT)).toBe("/library/agents/acme/variance-reporter?tab=make-it-yours");
    expect(result.current.putInApp?.(AGENT)).toBe("/library/agents/acme/variance-reporter?tab=in-app");
    expect(result.current.serviceAccounts).toBe("/settings/service-accounts");
    expect(result.current.embedding).toBe("/settings/org-embedding");
    expect(result.current.bringOthers).toBe("/settings/bring-others-in");
    expect(result.current.launch({ agent: AGENT, example: "variance-report", mode: "own" })).toBe(
      agentLaunchUrl("acme", "variance-reporter", { example: "variance-report", mode: "own" }),
    );
  });

  it("opens the launcher on the agent with its example and mode", () => {
    const params = new URL(agentLaunchUrl("acme", "variance-reporter", { example: "variance-report", mode: "sample" }), "https://app.example").searchParams;

    expect([params.get("agent"), params.get("example"), params.get("with")]).toEqual(["acme/variance-reporter", "variance-report", "sample"]);
    expect(agentLaunchUrl("acme", "your-agent", { example: undefined, mode: "own" })).toBe(`/?agent=${encodeURIComponent("acme/your-agent")}&with=own`);
  });

  it("draws each link with the router, so the hash routes hold", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        {renderJourneyLink({ href: "/settings/bring-others-in", className: "act", children: "Invite your team" })}
        <Location />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Invite your team" }));
    expect(screen.getByTestId("location").textContent).toBe("/settings/bring-others-in");
  });
});
