/**
 * Pins a new organization's first steps: three steps in order, each a link
 * the host routes (through its own link component when it passes one); a
 * provider that already serves a model marks the first step done, with no
 * link, and an organization that has an agent marks the second. "Say what
 * your agent should do" leads to the launcher's first question; it asks the
 * server's `can_create_agent` on the organization and links only on its yes
 * (CON-01): a no says who makes agents; a check in flight, or one that
 * failed, offers no link and says nothing about who may. The provider and
 * agent reads are stubbed; the self-check is answered by a client, as the
 * server would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { DashboardFirstSteps, type DashboardFirstStepsProps } from "../DashboardFirstSteps";

const state = vi.hoisted(() => ({ served: false, agents: 0 }));

vi.mock("../../models/useModelReadiness.js", () => ({
  useModelReadiness: () => ({
    providers: state.served ? [{ provider: "anthropic", availability: { state: "served", source: "organization", parentOrg: "" } }] : [],
  }),
}));

vi.mock("../../agent/useAgentList.js", () => ({
  useAgentList: () => ({ agents: Array.from({ length: state.agents }, (_, n) => ({ id: `agt_${n}` })) }),
}));

const LINKS = { connectProvider: "/models", createAgent: "/", startSession: "/" };

/** How the server answers "may this person create an agent here?". */
type CreateAnswer = "yes" | "no" | "asking" | "failing";

beforeEach(() => {
  state.served = false;
  state.agents = 0;
});
afterEach(cleanup);

function renderSteps(answer: CreateAnswer = "yes", props: Partial<DashboardFirstStepsProps> = {}) {
  const checkMyPermission = vi.fn((input: { relation: string; resource?: { kind: string; id: string } }) => {
    if (answer === "asking") return new Promise<never>(() => {});
    if (answer === "failing") return Promise.reject(new Error("unavailable"));
    return Promise.resolve({ isAuthorized: answer === "yes" && input.relation === "can_create_agent" });
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={{ grant: { checkMyPermission } } as never}>{children}</StigmerContext.Provider>
  );
  render(<DashboardFirstSteps org="org_acme" links={LINKS} {...props} />, { wrapper });
  return { checkMyPermission };
}

function steps(): HTMLElement[] {
  return within(screen.getByRole("region", { name: "Get your organization running" })).getAllByRole("listitem");
}

describe("DashboardFirstSteps", () => {
  it("lists the three steps in order, each a link to where it is taken", async () => {
    const { checkMyPermission } = renderSteps("yes");

    await waitFor(() => expect(within(steps()[1]!).queryByRole("link")).not.toBeNull());
    expect(steps().map((step) => within(step).getByRole("link").textContent)).toEqual([
      "Connect a provider",
      "Pick an example",
      "Start a session",
    ]);
    expect(screen.getByRole("link", { name: "Connect a provider" }).getAttribute("href")).toBe("/models");
    expect(steps()[1]!.textContent).toContain("Say what your agent should do");
    expect(steps()[1]!.textContent).toContain("Pick an example or describe your own; it runs on a sample file.");
    expect(screen.getByRole("link", { name: "Start a session" }).getAttribute("href")).toBe("/");
    expect(checkMyPermission.mock.calls[0]?.[0]).toMatchObject({
      relation: "can_create_agent",
      resource: { kind: "organization", id: "org_acme" },
    });
  });

  it("draws each link with the host's link component", async () => {
    renderSteps("yes", {
      renderLink: ({ href, className, children }) => (
        <a href={`#${href}`} className={className}>
          {children}
        </a>
      ),
    });

    expect((await screen.findByRole("link", { name: "Pick an example" })).getAttribute("href")).toBe("#/");
  });

  it("marks connecting a provider done once one serves a model", () => {
    state.served = true;
    renderSteps("yes");

    expect(within(steps()[0]!).queryByRole("link")).toBeNull();
    expect(steps()[0]!.textContent).toContain("(done)");
  });

  it("marks saying what the agent should do done once the organization has an agent", async () => {
    state.agents = 1;
    renderSteps("yes");

    await waitFor(() => expect(steps()[1]!.textContent).toContain("(done)"));
    expect(within(steps()[1]!).queryByRole("link")).toBeNull();
  });

  it("CON-01 says who makes agents, with no link, to a person the server refuses", async () => {
    renderSteps("no");

    await waitFor(() => expect(steps()[1]!.textContent).toContain("An admin of this organization makes agents"));
    expect(within(steps()[1]!).queryByRole("link")).toBeNull();
  });

  it("CON-01 offers no link to make an agent while the server has not answered", () => {
    renderSteps("asking");

    expect(within(steps()[1]!).queryByRole("link")).toBeNull();
    expect(steps()[1]!.textContent).not.toContain("An admin");
  });

  it("CON-01 offers no link to make an agent when the check failed, and claims nothing about who may", async () => {
    const { checkMyPermission } = renderSteps("failing");
    await waitFor(() => expect(checkMyPermission).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(within(steps()[1]!).queryByRole("link")).toBeNull();
    expect(steps()[1]!.textContent).not.toContain("An admin");
  });
});
