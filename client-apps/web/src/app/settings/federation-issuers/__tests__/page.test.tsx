// ---------------------------------------------------------------------------
// The /settings/federation-issuers route — renders the Federation Issuers
// settings section
//
// The page is the route's whole job: it hands the route to
// FederationIssuersSection, so a route that drifted to another section would
// show here. The section's behaviour is pinned by its own suite in
// @stigmer/react-sdk (settings/__tests__/FederationIssuersSection.test.tsx).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react-sdk", () => ({
  FederationIssuersSection: () => <p>federation issuers section</p>,
}));

import FederationIssuersPage from "../page";

describe("/settings/federation-issuers route", () => {
  it("renders the Federation Issuers section", () => {
    render(<FederationIssuersPage />);
    expect(screen.getByText("federation issuers section")).toBeTruthy();
  });
});
