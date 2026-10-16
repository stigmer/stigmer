/**
 * The public pricing page: the three editions, Stigmer Cloud's four flat
 * plans, and the rule that models run on the customer's own provider keys.
 *
 * Pins the plans and their fees (Free $0, Team $99, Business $499 with five
 * child organizations and $25 each beyond, Enterprise Cloud quoted), what
 * each card adds, the Enterprise Cloud card read from the console's own
 * description of it, the two ways to run Stigmer yourself (open source at
 * $0, Stigmer Enterprise quoted), the own-keys line under the plans, the
 * billing questions, and what must not come back: any credit wording, a
 * free model, an undefined SLA, single sign-on, a sandbox limit on a card,
 * or a fetch of a model price list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ENTERPRISE_CLOUD_PLAN, FEATURE_COPY } from "@stigmer/react";
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

    expect(within(card("Free")).getByText("Chat links")).toBeTruthy();
    expect(within(card("Free")).getByText("Slack and WhatsApp")).toBeTruthy();
    expect(within(card("Free")).getByText("Unlimited members")).toBeTruthy();
    expect(within(card("Team")).getByText("Teams")).toBeTruthy();
    expect(within(card("Business")).getByText("Child organizations")).toBeTruthy();
    expect(
      within(card("Business")).getByText("5 child organizations included, then $25/month each"),
    ).toBeTruthy();
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
