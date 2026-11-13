/**
 * The license ticket panel's revealed ticket: a long signed key in a block
 * that scrolls, so it is a named region a keyboard user tabs to, sees
 * focused and scrolls with the arrow keys (stigmer/stigmer#2899). Before the
 * operator asks, no ticket is in the page at all.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LicenseTicketPanel } from "../LicenseTicketPanel";

afterEach(cleanup);

const TICKET = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhY21lIn0.c2lnbmF0dXJl";

describe("LicenseTicketPanel", () => {
  it("shows no ticket until asked, then names it as a focusable region", () => {
    render(<LicenseTicketPanel ticket={TICKET} isLoading={false} error={null} />);
    expect(screen.queryByRole("region", { name: "License ticket" })).toBeNull();
    expect(screen.queryByText(TICKET)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show ticket" }));

    const region = screen.getByRole("region", { name: "License ticket" });
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain("stg:focus-visible:ring-2");
    expect(region.textContent).toBe(TICKET);
  });
});
