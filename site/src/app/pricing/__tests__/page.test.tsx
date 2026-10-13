/**
 * The `/pricing` route: Next metadata describing cloud pricing for search and
 * link previews, and a page that renders the pricing component.
 *
 * Pins the route's metadata copy (flat plans, the customer's own provider
 * keys, no charge for tokens, no credits) and that the route renders the
 * pricing page itself.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import Page, { metadata } from "../page";

afterEach(() => {
  cleanup();
});

describe("/pricing route", () => {
  it("describes flat plans on the customer's own keys in its metadata", () => {
    expect(metadata.title).toBe("Pricing");
    expect(metadata.description).toBe(
      "Stigmer Cloud pricing — four flat plans: Free, Team at $99 a month, Business at $499 a month, and Enterprise. Your agents run on your own model provider keys; Stigmer never charges for tokens.",
    );
    expect(metadata.openGraph?.title).toBe(`Pricing | ${SITE_CONFIG.name}`);
    expect(metadata.openGraph?.description).toBe(
      "Stigmer Cloud pricing — flat monthly plans. Models run on your own provider keys, and your provider bills you directly.",
    );
    expect(JSON.stringify(metadata)).not.toMatch(/credit/i);
  });

  it("renders the pricing page", () => {
    render(<Page />);

    expect(screen.getByText("Frequently Asked Questions")).toBeTruthy();
  });
});
