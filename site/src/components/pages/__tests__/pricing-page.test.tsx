/**
 * The public pricing page: the three editions, Stigmer Cloud's four flat
 * plans, and the rule that models run on the customer's own provider keys.
 *
 * Pins the plans and their fees (Free $0, Team $99, Business $499 with five
 * child organizations and $25 each beyond, Enterprise Cloud quoted), each
 * Cloud card's lines whole (its features, then its agent hours and how many
 * agents it runs at once, in the console's words), the Free and Enterprise
 * Cloud cards read from the console's own descriptions of them, the two ways
 * to run Stigmer yourself (open source at $0, Stigmer Enterprise quoted),
 * the own-keys line under the plans, the hero's price with its hours, the
 * billing questions, the sign-up button in sentence case, and what must not
 * come back: any credit wording, a free model, an undefined SLA, single
 * sign-on, a sandbox limit on a card, a flat fee stated as the whole price,
 * or a fetch of a model price list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ENTERPRISE_CLOUD_PLAN, FEATURE_COPY, FREE_PLAN, offeredFeatures, planTermLines } from "@stigmer/react-sdk";
import { PricingPage } from "../PricingPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function card(name: string): HTMLElement {
  return screen.getByRole("list", { name: `${name} features` });
}

function lines(name: string): readonly (string | null)[] {
  return within(card(name))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

describe("PricingPage", () => {
  it("sells four flat plans with their fees and what each adds", () => {
    render(<PricingPage />);

    expect(screen.getAllByText("$0")).toHaveLength(2);
    expect(screen.getByText("$99")).toBeTruthy();
    expect(screen.getByText("$499")).toBeTruthy();
    expect(screen.getAllByText("Custom")).toHaveLength(2);

    expect(lines("Free")).toEqual([
      "Slack and WhatsApp",
      "Chat links",
      "Unlimited members",
      "30 agent hours a month, then new work pauses",
      "5 agents at once",
    ]);
    expect(lines("Team")).toEqual([
      "Everything in Free",
      "Teams",
      "300 agent hours a month, then $0.40 an hour",
      "25 agents at once",
    ]);
    expect(lines("Business")).toEqual([
      "Everything in Team",
      "Child organizations",
      "5 child organizations included, then $25/month each",
      "1,500 agent hours a month, then $0.40 an hour",
      "100 agents at once",
    ]);
    expect(lines("Enterprise Cloud")).toEqual([
      "Everything in Business",
      "Access history",
      "Annual contract, invoiced",
    ]);
  });

  it("names the three editions, with Cloud's plans first and the two you run yourself under them", () => {
    render(<PricingPage />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("Stigmer Cloud")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("Run it yourself")).toBeGreaterThan(headings.indexOf("Stigmer Cloud"));
    expect(screen.getByRole("heading", { level: 3, name: "Stigmer open source" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Stigmer Enterprise" })).toBeTruthy();
    expect(within(card("Stigmer Enterprise")).getByText("Teams and invitations")).toBeTruthy();
    expect(within(card("Stigmer Enterprise")).getByText("Access history")).toBeTruthy();
  });

  it("renders Free from the console's description of it", () => {
    render(<PricingPage />);

    expect(lines(FREE_PLAN.name)).toEqual([
      ...offeredFeatures(FREE_PLAN.entitlements).map((feature) => feature.label),
      ...FREE_PLAN.extras,
      ...planTermLines(FREE_PLAN.entitlements, undefined),
    ]);
  });

  it("renders Enterprise Cloud from the console's description of it", () => {
    render(<PricingPage />);

    expect(lines(ENTERPRISE_CLOUD_PLAN.name)).toEqual([
      ENTERPRISE_CLOUD_PLAN.includes,
      ...ENTERPRISE_CLOUD_PLAN.features.map((feature) => FEATURE_COPY[feature].label),
      ENTERPRISE_CLOUD_PLAN.terms,
    ]);
  });

  it("says models run on the customer's own keys and answers the billing questions", () => {
    render(<PricingPage />);

    expect(
      screen.getByText(
        "Models run on your own provider keys, and your provider bills you directly. Stigmer never charges for tokens.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Do you charge for tokens?")).toBeTruthy();
    expect(screen.getByText("Whose model keys do my agents use?")).toBeTruthy();
    expect(screen.getByText(/Stigmer runs no model of its own, so add a key before your first run\./)).toBeTruthy();
    expect(screen.getByText("How are plans billed?")).toBeTruthy();
    expect(screen.getByText("What is an agent hour?")).toBeTruthy();
    expect(screen.getByText('What does "agents at once" mean?')).toBeTruthy();
    expect(screen.getByText(/never held back by this number/)).toBeTruthy();
  });

  it("states the price with its hours, never a flat fee as the whole of it", () => {
    const { container } = render(<PricingPage />);

    expect(
      screen.getByText(/^Every Stigmer Cloud plan is a flat monthly fee with agent hours included\./),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(/flat monthly fee(?! with agent hours included)/);
    expect(screen.getByText(/plus the agent hours past its allowance on a paid plan/)).toBeTruthy();
  });

  it("writes the sign-up button in sentence case", () => {
    const { container } = render(<PricingPage />);

    expect(container.textContent).not.toMatch(/Start Free/);
    expect(screen.getAllByRole("link", { name: "Start free" }).length).toBeGreaterThan(0);
  });

  it("names no credits, no sandbox limit, and fetches no price list", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<PricingPage />);

    expect(container.textContent).not.toMatch(/credit/i);
    expect(container.textContent).not.toMatch(/sandbox/i);
    expect(screen.queryByText("Per-Model Pricing")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("promises no free model, no SLA and no single sign-on", () => {
    const { container } = render(<PricingPage />);

    expect(container.textContent).not.toMatch(/free model/i);
    expect(container.textContent).not.toMatch(/\bSLA\b/);
    expect(container.textContent).not.toMatch(/single sign-on|\bSSO\b/i);
  });
});
