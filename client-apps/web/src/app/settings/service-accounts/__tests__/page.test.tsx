// ---------------------------------------------------------------------------
// The Settings → Service accounts route — renders the React SDK's section
//
// The page is the route's whole job: it hands Settings → Service accounts to
// ServiceAccountsSection (the organization's accounts for automation and
// their keys), so a route that drifted to another section would show here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react", () => ({
  ServiceAccountsSection: () => <p>service accounts section</p>,
}));

import ServiceAccountsPage from "../page";

describe("Settings → Service accounts route", () => {
  it("renders the service accounts section", () => {
    render(<ServiceAccountsPage />);
    expect(screen.getByText("service accounts section")).toBeTruthy();
  });
});
