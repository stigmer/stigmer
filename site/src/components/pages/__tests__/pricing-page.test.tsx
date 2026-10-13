/**
 * The public pricing page: four flat plans and the rule that models run on
 * the customer's own provider keys.
 *
 * Pins the plans and their fees (Free $0, Team $99, Business $499 with five
 * child organizations and $25 each beyond, Enterprise quoted), what each
 * card adds, the own-keys line under the plans, the three billing questions,
 * and what must not come back: any credit wording, a sandbox limit on a
 * card, or a fetch of a model price list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { PricingPage } from "../PricingPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function card(name: string): HTMLElement {
  return screen.getByRole("list", { name: `${name} features` });
}

describe("PricingPage", () => {
  it("sells four flat plans with their fees and what each adds", () => {
    render(<PricingPage />);

    expect(screen.getByText("$0")).toBeTruthy();
    expect(screen.getByText("$99")).toBeTruthy();
    expect(screen.getByText("$499")).toBeTruthy();
    expect(screen.getByText("Custom")).toBeTruthy();

    expect(within(card("Free")).getByText("Channels")).toBeTruthy();
    expect(within(card("Free")).getByText("Sharing")).toBeTruthy();
    expect(within(card("Free")).getByText("Unlimited members")).toBeTruthy();
    expect(within(card("Team")).getByText("Teams")).toBeTruthy();
    expect(within(card("Business")).getByText("Child organizations")).toBeTruthy();
    expect(
      within(card("Business")).getByText("5 child organizations included, then $25/month each"),
    ).toBeTruthy();
    expect(within(card("Enterprise")).getByText("A dedicated deployment")).toBeTruthy();
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
    expect(screen.getByText("How are plans billed?")).toBeTruthy();
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
});
