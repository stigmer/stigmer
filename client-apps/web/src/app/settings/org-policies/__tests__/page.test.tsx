// ---------------------------------------------------------------------------
// The Settings → Policies route — renders the React SDK's policies section
//
// The page is the route's whole job: it hands Settings → Policies to
// OrgPoliciesSection (what the organization lets its members do), so a
// route that drifted to another section would show here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react", () => ({
  OrgPoliciesSection: () => <p>policies section</p>,
}));

import OrgPoliciesPage from "../page";

describe("Settings → Policies route", () => {
  it("renders the policies section", () => {
    render(<OrgPoliciesPage />);
    expect(screen.getByText("policies section")).toBeTruthy();
  });
});
