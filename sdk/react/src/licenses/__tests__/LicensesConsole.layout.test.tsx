// Layout contract for the licenses calendar's column budget. Runs in a
// real Chromium via `vitest.a11y.config.ts`: the failure this pins is a
// grid-track collapse (the class stigmer#929 found in the Cursor coverage
// table), which only a real layout engine can resolve.
//
// Two halves, the coverage table's precedent:
//
// 1. At the settings canvas (both client apps render settings in
//    `max-w-3xl`, about 720px of content) the calendar fits without
//    horizontal scroll, and the customer column holds a real name and
//    address on one line each.
// 2. In a narrower host (the console is embeddable at any width) the
//    min-width guard turns crushing into horizontal scrolling.
//
// Rendered against the SHIPPED stylesheet (`dist/styles.css`, built by
// `npm run build:libs`), so the contract holds on what consumers load.

import "../../../dist/styles.css";

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { StigmerProvider } from "../../provider";
import { LicensesConsole } from "../LicensesConsole";
import { license } from "./fixtures";

afterEach(cleanup);

const NOW = new Date("2026-09-28T09:00:00Z");

/** The widest realistic row: a long company name, a long address, both limits, every feature. */
const entries = [
  license({
    id: "lic_wide",
    customerName: "Northwind Logistics International",
    contactEmail: "procurement.licensing@northwind-logistics.test",
    issuedAt: "2026-01-15T00:00:00Z",
    expiresAt: "2027-01-15T00:00:00Z",
    graceUntil: "2027-02-14T00:00:00Z",
    maxUsers: 1500,
    maxOrganizations: 12,
    features: [
      Feature.sso_enforcement,
      Feature.platform_client,
      Feature.byo_provider_keys,
      Feature.channels,
      Feature.sharing,
    ],
  }),
  license({
    id: "lic_grace",
    customerId: "cus_globex",
    customerName: "Globex",
    contactEmail: "it@globex.test",
    issuedAt: "2025-09-01T00:00:00Z",
    expiresAt: "2026-09-20T00:00:00Z",
    graceUntil: "2026-10-20T00:00:00Z",
  }),
  license({
    id: "lic_short",
    customerId: "cus_beta",
    customerName: "Beta",
    contactEmail: "it@beta.test",
    issuedAt: "2026-09-01T00:00:00Z",
    expiresAt: "2026-10-01T00:00:00Z",
  }),
];

// A minimal client: the provider fetches registries on mount; a null
// credential keeps that off the network. The console reads only `license`.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
    license: {
      list: async () => ({ entries }),
      get: async () => entries[0],
      create: async () => entries[0],
    },
  } as unknown as Stigmer;
}

async function renderCalendarAt(hostWidth: number) {
  render(
    <div style={{ width: hostWidth }}>
      <StigmerProvider client={makeClient()} deploymentMode="cloud">
        <LicensesConsole now={NOW} />
      </StigmerProvider>
    </div>,
  );
  const table = await screen.findByRole("table", { name: "Licenses" });
  // The overflow guard is the table's direct wrapper (the card-chrome div).
  return { table, scroller: table.parentElement as HTMLElement };
}

function lineCount(el: HTMLElement): number {
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
  return Math.round(el.getBoundingClientRect().height / lineHeight);
}

describe("LicensesConsole column budget", () => {
  it("fits the 720px settings canvas without horizontal scroll, the customer legible", async () => {
    const { scroller } = await renderCalendarAt(720);

    expect(scroller.scrollWidth).toBe(scroller.clientWidth);

    const name = screen.getByRole("button", { name: "Northwind Logistics International" });
    const cell = name.closest('[role="cell"]') as HTMLElement;
    expect(cell.getBoundingClientRect().width).toBeGreaterThan(160);
    // Name and address truncate rather than wrap: one line each.
    expect(lineCount(name)).toBe(1);
    expect(lineCount(screen.getByText("procurement.licensing@northwind-logistics.test"))).toBe(1);
    // The in-grace deadline holds on one line in its track.
    expect(lineCount(screen.getByText("Grace ends 2026-10-19"))).toBe(1);
  });

  it("scrolls horizontally in a narrow host instead of collapsing a column", async () => {
    const { table, scroller } = await renderCalendarAt(400);

    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    expect(table.getBoundingClientRect().width).toBeGreaterThanOrEqual(672);

    const cell = screen
      .getByRole("button", { name: "Northwind Logistics International" })
      .closest('[role="cell"]') as HTMLElement;
    expect(cell.getBoundingClientRect().width).toBeGreaterThan(140);
  });
});
