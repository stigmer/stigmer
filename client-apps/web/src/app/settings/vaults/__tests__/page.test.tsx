// ---------------------------------------------------------------------------
// The Settings → Vaults route — renders the React SDK's vaults section
//
// The page is the route's whole job: it hands Settings → Vaults to
// VaultsSection (My vault and the organization's shared vaults), so a route
// that drifted to another section would show here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react", () => ({
  VaultsSection: () => <p>vaults section</p>,
}));

import VaultsPage from "../page";

describe("Settings → Vaults route", () => {
  it("renders the vaults section", () => {
    render(<VaultsPage />);
    expect(screen.getByText("vaults section")).toBeTruthy();
  });
});
