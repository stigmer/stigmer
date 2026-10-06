/**
 * The `/pricing` route: Next metadata describing cloud pricing for search and
 * link previews, and a page that renders the pricing component.
 *
 * Pins the route's metadata copy (credits buy AI agent runs) and that the
 * route renders the pricing page itself.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import Page, { metadata } from "../page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/pricing route", () => {
  it("describes prepaid credits for agent runs in its metadata", () => {
    expect(metadata.title).toBe("Pricing");
    expect(metadata.openGraph?.title).toBe(`Pricing | ${SITE_CONFIG.name}`);
    expect(metadata.openGraph?.description).toBe(
      "Stigmer Cloud pricing — prepaid credits for AI agent runs. Transparent per-model token pricing.",
    );
  });

  it("renders the pricing page", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    render(<Page />);

    expect(screen.getByText("Frequently Asked Questions")).toBeTruthy();
  });
});
