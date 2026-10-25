// The plan section end to end over a mock client: Free with the comparison
// (only what Cloud offers today, Enterprise Cloud as "Talk to us"), a viewer's
// read-only view, the card door (leaving through the host's openUrl with
// the plan to come back to), a subscribe, an active plan's estimate and
// its switch and cancel copy (child organizations beyond those included
// among its lines), the agent hours used of those the plan includes on
// every plan (pausing, priced, unlimited, past the allowance, and left out
// where the server does not serve the read), how many agents a plan runs at
// once beside its hours, the plans cheapest first and what a switch
// down gives up, the reopened choice after a card was saved,
// a child organization, and nothing at all where subscriptions are not
// served.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { clone, create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/client";
import {
  AgentHoursSchema,
  AgentHoursWindow,
  PeriodEstimateLineKind,
  PeriodEstimateLineSchema,
  PeriodEstimateSchema,
} from "@stigmer/apis/ai/stigmer/billing/subscription/v1/io_pb";
import { PlanSchema } from "@stigmer/apis/ai/stigmer/billing/plan/v1/api_pb";
import { EntitlementLimitsSchema } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import { SubscriptionState } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/status_pb";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { PlanSection, type PlanSectionProps } from "../PlanSection";
import { BUSINESS, FREE_HOURS, NOW, RETIRED, TEAM, TEAM_ESTIMATE, USD, notFound, subscription } from "./fixtures";

afterEach(cleanup);

function mockClient(options: { admin?: boolean; subscribed?: ReturnType<typeof subscription> } = {}) {
  return {
    plan: { list: vi.fn().mockResolvedValue({ entries: [TEAM, BUSINESS, RETIRED], nextPageToken: "" }) },
    subscription: {
      getForOrg: options.subscribed
        ? vi.fn().mockResolvedValue(options.subscribed)
        : vi.fn().mockRejectedValue(notFound()),
      getPeriodEstimate: vi.fn().mockResolvedValue(TEAM_ESTIMATE),
      getAgentHours: vi.fn().mockResolvedValue(FREE_HOURS),
      changePlan: vi.fn().mockResolvedValue(subscription(SubscriptionState.active)),
      cancel: vi.fn().mockResolvedValue(subscription(SubscriptionState.canceled)),
    },
    billing: {
      createPaymentMethodSetupSession: vi.fn().mockResolvedValue({ setupUrl: "https://checkout.stripe.com/c/setup_1" }),
    },
    grant: { checkMyPermission: vi.fn().mockResolvedValue({ isAuthorized: options.admin ?? true }) },
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
  return render(<PlanSection org="acme" hasPaymentMethod now={NOW} {...props} />, { wrapper: Wrapper });
}

describe("PlanSection", () => {
  it("shows Free and the comparison, with only what Cloud offers today", async () => {
    renderSection(mockClient());
    const plans = await screen.findByRole("list", { name: "Plans" });
    const business = await planOption("Business");
    expect(within(business).getByText("5 child organizations included, then $25.00/month each")).toBeTruthy();
    expect(within(business).getByText("Child organizations")).toBeTruthy();
    // Provider keys are on every plan, so no plan sells them.
    expect(within(plans).queryByText("Bring your own provider keys")).toBeNull();
    expect(within(plans).queryByText("Team 2026")).toBeNull();
    expect(within(plans).getByRole("link", { name: "Talk to us" }).getAttribute("href")).toBe(
      "https://stigmer.ai/contact-sales",
    );
    // The quoted plan lists what the contract tiers to it, and promises nothing undefined.
    const enterpriseCloud = await planOption("Enterprise Cloud");
    expect(Array.from(enterpriseCloud.querySelectorAll("li"), (line) => line.textContent)).toEqual([
      "Everything in Business",
      "Access history",
      "Annual contract, invoiced",
    ]);
    expect(within(plans).queryByText(/\bSLA\b|dedicated deployment/)).toBeNull();
    expect(within(plans).getAllByRole("button", { name: "Subscribe" })).toHaveLength(2);
  });

  it("says what agent hours a plan includes and what happens past them, and nothing for a plan that states none", async () => {
    const client = mockClient();
    const hourly = clone(PlanSchema, TEAM);
    if (hourly.spec?.entitlements === undefined || hourly.spec.terms === undefined) throw new Error("TEAM has no terms");
    hourly.spec.entitlements.limits = create(EntitlementLimitsSchema, { includedAgentHours: 25 });
    hourly.spec.terms.perAgentHourMicros = USD / 2n;
    client.plan.list.mockResolvedValue({ entries: [hourly, BUSINESS], nextPageToken: "" });
    renderSection(client);
    expect(within(await planOption("Team")).getByText("25 agent hours a month, then $0.50 an hour")).toBeTruthy();
    expect(within(await planOption("Business")).queryByText(/agent hour/)).toBeNull();
  });

  it("says how many agents a plan runs at once, beside its hours, and nothing for a plan that states no number", async () => {
    const client = mockClient();
    const sized = clone(PlanSchema, TEAM);
    if (sized.spec?.entitlements === undefined || sized.spec.terms === undefined) throw new Error("TEAM has no terms");
    sized.spec.entitlements.limits = create(EntitlementLimitsSchema, { includedAgentHours: 300, maxActiveSessionSandboxes: 25 });
    sized.spec.terms.perAgentHourMicros = (USD * 3n) / 10n;
    client.plan.list.mockResolvedValue({ entries: [sized, BUSINESS], nextPageToken: "" });
    renderSection(client);
    const team = await planOption("Team");
    const lines = Array.from(team.querySelectorAll("li"), (line) => line.textContent);
    expect(lines.slice(-2)).toEqual(["300 agent hours a month, then $0.30 an hour", "25 agents at once"]);
    expect(within(await planOption("Business")).queryByText(/at once/)).toBeNull();
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
      org: "acme",
      successUrl: "https://app.stigmer.ai/settings/billing?setup=success&plan=pln_team",
      cancelUrl: "https://app.stigmer.ai/settings/billing",
    });
    expect(client.subscription.changePlan).not.toHaveBeenCalled();
  });

  it("subscribes on an explicit confirm that states the monthly fee and says nothing is charged today", async () => {
    const client = mockClient();
    renderSection(client);
    await userEvent.click(within(await planOption("Team")).getByRole("button", { name: "Subscribe" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/billed when it ends: \$99\.00\/month\.$/)).toBeTruthy();
    expect(within(dialog).getByText("Nothing is charged today.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Subscribe" }));
    await waitFor(() => expect(client.subscription.changePlan).toHaveBeenCalledTimes(1));
    expect(client.subscription.changePlan.mock.calls[0]?.[0]).toMatchObject({ org: "acme", planId: "pln_team" });
  });

  it("shows an active plan's estimate, and says a cancel runs to the period's end", async () => {
    const client = mockClient({ subscribed: subscription(SubscriptionState.active) });
    renderSection(client);
    expect(await screen.findByText("Estimated invoice on Feb 28, 2027")).toBeTruthy();
    expect(screen.getByText("Team plan")).toBeTruthy();
    // The plan line and the total: the fee is the whole invoice.
    expect(screen.getAllByText("$99.00")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Switch to Business" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Move to Free" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Team stays in force until Feb 28, 2027/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel plan" }));
    await waitFor(() => expect(client.subscription.cancel).toHaveBeenCalledTimes(1));
  });

  it("names an estimate's child organizations beyond those included, with the period's count", async () => {
    const client = mockClient({ subscribed: subscription(SubscriptionState.active) });
    client.subscription.getPeriodEstimate.mockResolvedValue(
      create(PeriodEstimateSchema, {
        ...TEAM_ESTIMATE,
        lines: [
          ...TEAM_ESTIMATE.lines,
          create(PeriodEstimateLineSchema, { kind: PeriodEstimateLineKind.child_orgs, amountMicros: 40_000_000n }),
        ],
        childOrgCount: 5,
      }),
    );
    renderSection(client);
    expect(await screen.findByText("Child organizations beyond those included (5 this period)")).toBeTruthy();
    expect(screen.getByText("$40.00")).toBeTruthy();
  });

  it("names an estimate's agent hours beyond those included, with the hours worked so far", async () => {
    const client = mockClient({ subscribed: subscription(SubscriptionState.active) });
    client.subscription.getPeriodEstimate.mockResolvedValue(
      create(PeriodEstimateSchema, {
        ...TEAM_ESTIMATE,
        lines: [
          ...TEAM_ESTIMATE.lines,
          create(PeriodEstimateLineSchema, { kind: PeriodEstimateLineKind.agent_hours, amountMicros: 3_100_000n }),
        ],
        workingSeconds: 112_320n,
      }),
    );
    renderSection(client);
    expect(await screen.findByText("Agent hours beyond those included (31.2 h worked this period)")).toBeTruthy();
    expect(screen.getByText("$3.10")).toBeTruthy();
  });

  it("shows Free's hours used of those included this month, when they reset and that new work pauses", async () => {
    const client = mockClient();
    renderSection(client);
    expect(await screen.findByText("3.2 h of 10 h used this month")).toBeTruthy();
    expect(client.subscription.getAgentHours.mock.calls[0]?.[0]).toMatchObject({ org: "acme" });
    const meter = screen.getByRole("meter", { name: "Agent hours used" });
    expect([meter.getAttribute("aria-valuenow"), meter.getAttribute("aria-valuemax")]).toEqual(["11520", "36000"]);
    expect(screen.getByText("Resets Mar 1, 2027 (UTC). New work pauses at the allowance.")).toBeTruthy();
    expect(screen.getByText(/automatic grading is never counted/)).toBeTruthy();
  });

  it("says new work is paused once a pausing plan's allowance is used, the meter full", async () => {
    const client = mockClient();
    client.subscription.getAgentHours.mockResolvedValue(create(AgentHoursSchema, { ...FREE_HOURS, workingSeconds: 37_000n }));
    renderSection(client);
    expect(await screen.findByText("10.3 h of 10 h used this month")).toBeTruthy();
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("36000");
    expect(
      screen.getByText("The allowance is used: new work is paused until the count resets Mar 1, 2027 (UTC)."),
    ).toBeTruthy();
  });

  it("gives a priced plan's hourly price past its allowance, on the period's invoice", async () => {
    const client = mockClient({ subscribed: subscription(SubscriptionState.active) });
    const priced = { ...FREE_HOURS, includedHours: 25, perAgentHourMicros: USD / 2n, window: AgentHoursWindow.billing_period };
    client.subscription.getAgentHours.mockResolvedValue(create(AgentHoursSchema, { ...priced, workingSeconds: 66_240n }));
    renderSection(client);
    expect(await screen.findByText("18.4 h of 25 h used this period")).toBeTruthy();
    expect(screen.getByText("Resets Mar 1, 2027 (UTC). Then $0.50 an hour, on this period's invoice.")).toBeTruthy();

    cleanup();
    client.subscription.getAgentHours.mockResolvedValue(create(AgentHoursSchema, { ...priced, workingSeconds: 93_600n }));
    renderSection(client);
    expect(
      await screen.findByText("Past the allowance: each hour is $0.50 on this period's invoice. Resets Mar 1, 2027 (UTC)."),
    ).toBeTruthy();
  });

  it("shows a plan with no allowance its hours used and no meter", async () => {
    const client = mockClient({ subscribed: subscription(SubscriptionState.active) });
    client.subscription.getAgentHours.mockResolvedValue(
      create(AgentHoursSchema, {
        workingSeconds: 66_240n,
        windowEnd: FREE_HOURS.windowEnd,
        window: AgentHoursWindow.billing_period,
      }),
    );
    renderSection(client);
    expect(await screen.findByText("18.4 h used this period")).toBeTruthy();
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("leaves the hours out where the server does not serve the read, and says so on any other failure", async () => {
    const client = mockClient();
    client.subscription.getAgentHours.mockRejectedValue(
      new StigmerError("unknown", "[unimplemented] getAgentHours", Code.Unimplemented),
    );
    renderSection(client);
    await screen.findByRole("list", { name: "Plans" });
    await waitFor(() => expect(client.subscription.getAgentHours).toHaveBeenCalled());
    expect(screen.queryByText("Agent hours")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    cleanup();
    client.subscription.getAgentHours.mockRejectedValue(new StigmerError("internal", "the ledger is down", Code.Internal));
    renderSection(client);
    expect((await screen.findByRole("alert")).textContent).toContain("Agent hours could not be read");
  });

  it("lists the plans cheapest first, and names what a switch down gives up but not a switch up", async () => {
    const client = mockClient({ subscribed: subscription(SubscriptionState.active, "pln_business") });
    renderSection(client);
    const plans = await screen.findByRole("list", { name: "Plans" });
    const names = Array.from(plans.children, (item) => item.querySelector("p")?.textContent);
    expect(names).toEqual(["Free", "Team", "Business", "Enterprise Cloud"]);

    await userEvent.click(screen.getByRole("button", { name: "Switch to Team" }));
    const down = await screen.findByRole("dialog");
    expect(within(down).getByText(/Team does not include Child organizations\./)).toBeTruthy();
    expect(within(down).getByText(/Everything you built keeps working/)).toBeTruthy();
    expect(within(down).queryByText(/provider keys/)).toBeNull();
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
    view.rerender(<PlanSection org="acme" hasPaymentMethod now={NOW} />);
    view.rerender(<PlanSection org="acme" hasPaymentMethod now={NOW} resumePlanId="pln_team" />);
    const second = await screen.findByRole("dialog");
    expect(within(second).getByRole("heading", { name: "Subscribe to Team" })).toBeTruthy();
  });

  it("tells a child organization it is billed to its parent, and estimates nothing", async () => {
    const client = mockClient();
    renderSection(client, { billedToParent: "planton" });
    expect(await screen.findByText("Billed to planton")).toBeTruthy();
    expect(screen.getByText(/runs on its parent organization's plan/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Plans" })).toBeNull();
    expect(client.subscription.getPeriodEstimate).not.toHaveBeenCalled();
    expect(client.subscription.getAgentHours, "a child's hours are its parent's pool").not.toHaveBeenCalled();
    expect(screen.queryByText("Agent hours")).toBeNull();
  });

  it("names no raw id when the parent cannot be shown", async () => {
    const client = mockClient();
    renderSection(client, { billedToParent: "" });
    expect(await screen.findByText("Billed to its parent organization")).toBeTruthy();
  });

  it("renders nothing where subscriptions are not served", () => {
    const client = mockClient();
    const { container } = renderSection(client, {}, "local");
    expect(container.textContent).toBe("");
    expect(client.subscription.getForOrg).not.toHaveBeenCalled();
  });
});
