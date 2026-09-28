// The plan section end to end over a mock client: Free with the comparison
// (only what Cloud offers today, Enterprise as "Talk to us"), a viewer's
// read-only view, the card door (leaving through the host's openUrl with
// the plan to come back to), a subscribe, an active plan's estimate and
// its switch and cancel copy, the plans cheapest first and what a switch
// down gives up, the reopened choice after a card was saved,
// a managed organization, and nothing at all where subscriptions are not
// served.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SubscriptionState } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/status_pb";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { PlanSection, type PlanSectionProps } from "../PlanSection";
import { BUSINESS, NOW, RETIRED, TEAM, TEAM_ESTIMATE, notFound, subscription } from "./fixtures";

afterEach(cleanup);

function mockClient(options: { admin?: boolean; subscribed?: ReturnType<typeof subscription> } = {}) {
  return {
    plan: { list: vi.fn().mockResolvedValue({ entries: [TEAM, BUSINESS, RETIRED] }) },
    subscription: {
      getForOrganization: options.subscribed
        ? vi.fn().mockResolvedValue(options.subscribed)
        : vi.fn().mockRejectedValue(notFound()),
      getPeriodEstimate: vi.fn().mockResolvedValue(TEAM_ESTIMATE),
      changePlan: vi.fn().mockResolvedValue(subscription(SubscriptionState.active)),
      cancel: vi.fn().mockResolvedValue(subscription(SubscriptionState.canceled)),
    },
    billing: {
      createPaymentMethodSetupSession: vi.fn().mockResolvedValue({ setupUrl: "https://checkout.stripe.com/c/setup_1" }),
    },
    iamPolicy: { checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: options.admin ?? true }) },
  };
}

/** The comparison's option for the plan named `name`. */
async function planOption(name: string): Promise<HTMLElement> {
  const plans = await screen.findByRole("list", { name: "Plans" });
  const option = within(plans)
    .getAllByRole("listitem")
    .find((item) => item.querySelector("p")?.textContent === name);
  if (option === undefined) throw new Error(`no plan option named ${name}`);
  return option;
}

function renderSection(client: unknown, props: Partial<PlanSectionProps> = {}, mode: "local" | "cloud" = "cloud") {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <DeploymentModeContext.Provider value={mode}>
          <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
        </DeploymentModeContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return render(<PlanSection orgId="acme" hasPaymentMethod now={NOW} {...props} />, { wrapper: Wrapper });
}

describe("PlanSection", () => {
  it("shows Free and the comparison, with only what Cloud offers today", async () => {
    renderSection(mockClient());
    const plans = await screen.findByRole("list", { name: "Plans" });
    const business = await planOption("Business");
    expect(within(business).getByText("5 managed organizations included, then $25.00/month each")).toBeTruthy();
    expect(within(business).queryByText(/provider keys/i)).toBeNull();
    expect(within(plans).queryByText("Team 2026")).toBeNull();
    expect(within(plans).getByRole("link", { name: "Talk to us" }).getAttribute("href")).toBe(
      "https://stigmer.ai/contact-sales",
    );
    expect(within(plans).getAllByRole("button", { name: "Subscribe" })).toHaveLength(2);
  });

  it("offers a viewer no choices", async () => {
    renderSection(mockClient({ admin: false }));
    await screen.findByRole("list", { name: "Plans" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull());
  });

  it("sends a subscriber without a card to Stripe's page through the host, to come back to the plan", async () => {
    const client = mockClient();
    const openUrl = vi.fn().mockResolvedValue(undefined);
    renderSection(client, {
      hasPaymentMethod: false,
      redirect: { openUrl, returnUrl: "https://app.stigmer.ai/settings/billing" },
    });
    await userEvent.click(within(await planOption("Team")).getByRole("button", { name: "Subscribe" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add a payment method" }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://checkout.stripe.com/c/setup_1"));
    expect(client.billing.createPaymentMethodSetupSession).toHaveBeenCalledWith({
      orgId: "acme",
      successUrl: "https://app.stigmer.ai/settings/billing?setup=success&plan=pln_team",
      cancelUrl: "https://app.stigmer.ai/settings/billing",
    });
    expect(client.subscription.changePlan).not.toHaveBeenCalled();
  });

  it("subscribes on an explicit confirm that says nothing is charged today", async () => {
    const client = mockClient();
    renderSection(client);
    await userEvent.click(within(await planOption("Team")).getByRole("button", { name: "Subscribe" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nothing is charged today.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Subscribe" }));
    await waitFor(() => expect(client.subscription.changePlan).toHaveBeenCalledTimes(1));
    expect(client.subscription.changePlan.mock.calls[0]?.[0]).toMatchObject({ orgId: "acme", planId: "pln_team" });
  });

  it("shows an active plan's estimate, and says a cancel runs to the period's end", async () => {
    const client = mockClient({ subscribed: subscription(SubscriptionState.active) });
    renderSection(client);
    expect(await screen.findByText("Estimated invoice on Feb 28, 2027")).toBeTruthy();
    expect(screen.getByText("Team plan")).toBeTruthy();
    expect(screen.getByText("Commission already paid on tokens")).toBeTruthy();
    expect(screen.getByText("-$8.00")).toBeTruthy();
    expect(screen.getByText("$91.00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to Business" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Move to Free" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Team stays in force until Feb 28, 2027/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel plan" }));
    await waitFor(() => expect(client.subscription.cancel).toHaveBeenCalledTimes(1));
  });

  it("lists the plans cheapest first, and names what a switch down gives up but not a switch up", async () => {
    const client = mockClient({ subscribed: subscription(SubscriptionState.active, "pln_business") });
    renderSection(client);
    const plans = await screen.findByRole("list", { name: "Plans" });
    const names = Array.from(plans.children, (item) => item.querySelector("p")?.textContent);
    expect(names).toEqual(["Free", "Team", "Business", "Enterprise"]);

    await userEvent.click(screen.getByRole("button", { name: "Switch to Team" }));
    const down = await screen.findByRole("dialog");
    expect(within(down).getByText(/Team does not include Managed organizations\./)).toBeTruthy();
    await userEvent.click(within(down).getByRole("button", { name: "Not now" }));

    cleanup();
    renderSection(mockClient({ subscribed: subscription(SubscriptionState.active) }));
    await userEvent.click(await screen.findByRole("button", { name: "Switch to Business" }));
    const up = await screen.findByRole("dialog");
    expect(within(up).queryByText(/does not include/)).toBeNull();
  });

  it("reopens the choice a person left to save a card for, without subscribing on its own", async () => {
    const client = mockClient();
    const onResumeHandled = vi.fn();
    renderSection(client, { resumePlanId: "pln_business", onResumeHandled });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Subscribe to Business" })).toBeTruthy();
    expect(onResumeHandled).toHaveBeenCalledTimes(1);
    expect(client.subscription.changePlan).not.toHaveBeenCalled();
  });

  it("reopens a choice again when a host that stays mounted returns a second time", async () => {
    const client = mockClient();
    const view = renderSection(client, { resumePlanId: "pln_business" });
    const first = await screen.findByRole("dialog");
    await userEvent.click(within(first).getByRole("button", { name: "Not now" }));
    view.rerender(<PlanSection orgId="acme" hasPaymentMethod now={NOW} />);
    view.rerender(<PlanSection orgId="acme" hasPaymentMethod now={NOW} resumePlanId="pln_team" />);
    const second = await screen.findByRole("dialog");
    expect(within(second).getByRole("heading", { name: "Subscribe to Team" })).toBeTruthy();
  });

  it("tells a managed organization it is on its integrator's plan, and estimates nothing", async () => {
    const client = mockClient();
    renderSection(client, { managed: true });
    expect(await screen.findByText(/managed by its integrator/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Plans" })).toBeNull();
    expect(client.subscription.getPeriodEstimate).not.toHaveBeenCalled();
  });

  it("renders nothing where subscriptions are not served", () => {
    const client = mockClient();
    const { container } = renderSection(client, {}, "local");
    expect(container.textContent).toBe("");
    expect(client.subscription.getForOrganization).not.toHaveBeenCalled();
  });
});
