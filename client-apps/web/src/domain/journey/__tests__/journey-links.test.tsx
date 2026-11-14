/**
 * Pins the console's journey routes: "Make it yours" and "Put it in your
 * app" open the agent page on its tab, the team is invited on the members
 * page, and a launch opens the launcher on the agent with its example and
 * mode, which the launcher reads back; an organization named by id is
 * written as its slug; each link is drawn with Next's `Link`.
 */
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";

vi.mock("@stigmer/react-sdk", () => ({
  useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children?: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className} data-next-link="">
      {children}
    </a>
  ),
}));

import { renderJourneyLink, useJourneyLinks } from "../journey-links";

const AGENT = { org: "org_acme", slug: "variance-reporter" };

describe("web journey links", () => {
  it("routes each later step, naming the organization by its slug", () => {
    const { result } = renderHook(() => useJourneyLinks());

    expect(result.current.makeItYours?.(AGENT)).toBe("/library/agents/acme/variance-reporter?tab=make-it-yours");
    expect(result.current.putInApp?.(AGENT)).toBe("/library/agents/acme/variance-reporter?tab=in-app");
    expect(result.current.serviceAccounts).toBe("/settings/service-accounts");
    expect(result.current.embedding).toBe("/settings/org-embedding");
    expect(result.current.bringOthers).toBe("/settings/bring-others-in");
  });

  it("opens the launcher on the agent with its example and mode, as the launcher reads them", () => {
    const { result } = renderHook(() => useJourneyLinks());
    const href = result.current.launch({ agent: AGENT, example: "variance-report", mode: "sample" });
    const params = new URL(href, "https://console.example").searchParams;

    expect(href.startsWith("/?")).toBe(true);
    expect([params.get("agent"), params.get("example"), params.get("with")]).toEqual(["acme/variance-reporter", "variance-report", "sample"]);
    expect(new URL(result.current.launch({ agent: AGENT, example: undefined, mode: "own" }), "https://console.example").searchParams.has("example")).toBe(false);
  });

  it("draws each link with Next's Link", () => {
    render(<>{renderJourneyLink({ href: "/settings/bring-others-in", className: "act", children: "Invite your team" })}</>);

    const link = screen.getByRole("link", { name: "Invite your team" });
    expect(link.getAttribute("href")).toBe("/settings/bring-others-in");
    expect(link.hasAttribute("data-next-link")).toBe(true);
  });
});
