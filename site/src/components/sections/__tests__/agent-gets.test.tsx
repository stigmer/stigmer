/**
 * The landing page's "What each customer's agent gets" cards.
 *
 * Pins the cards to the vocabulary's list, in its order, each linking the page
 * that shows it: "It works for hours" is second and leads to the Sessions
 * section that says what a long job is. Pins too that the grid fills every row
 * at each width, since an empty cell shows the border colour as a grey block.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentGets } from "../AgentGets";

afterEach(cleanup);

const CARDS = [
  ["Its own computer", "/docs/concepts/environments"],
  ["It works for hours", "/docs/concepts/sessions#a-job-that-runs-for-hours"],
  ["It asks first", "/docs/concepts/approval-flows"],
  ["Walls between customers", "/docs/getting-started/one-organization-per-customer"],
  ["Your keys, your servers", "/docs/guides/self-hosting/cloud-vs-self-hosted"],
] as const;

/** The columns a card spans at a breakpoint, from its `<prefix>:col-span-N` class; one when it has none. */
const span = (card: Element, prefix: string) =>
  Number(new RegExp(`(?:^|\\s)${prefix}:col-span-(\\d+)`).exec(card.className)?.[1] ?? 1);

describe("AgentGets", () => {
  it("lists what each customer's agent has in the vocabulary's order, each linking its page", () => {
    render(<AgentGets />);

    const titles = screen.getAllByRole("heading", { level: 3 });
    expect(titles.map((title) => title.textContent)).toEqual(CARDS.map(([title]) => title));
    for (const [index, [, href]] of CARDS.entries()) {
      const card = titles[index].parentElement;
      expect(card?.querySelector("a")?.getAttribute("href")).toBe(href);
    }
  });

  it("fills every row of the grid at each width", () => {
    const { container } = render(<AgentGets />);

    const grid = container.querySelector(".grid");
    const cards = [...(grid?.children ?? [])];
    expect(cards).toHaveLength(CARDS.length);
    expect(grid?.className).toMatch(/(?:^|\s)sm:grid-cols-2(?:\s|$)/);
    expect(grid?.className).toMatch(/(?:^|\s)lg:grid-cols-6(?:\s|$)/);
    expect(cards.reduce((sum, card) => sum + span(card, "sm"), 0) % 2).toBe(0);
    expect(cards.map((card) => span(card, "lg"))).toEqual([2, 2, 2, 3, 3]);
  });
});
