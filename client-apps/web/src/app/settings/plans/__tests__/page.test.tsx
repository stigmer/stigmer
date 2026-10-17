// ---------------------------------------------------------------------------
// The Settings → Plans route — renders the React SDK's plan catalog console
//
// The page is the route's whole job: it hands the operator-gated Plans
// entry to PlanCatalogConsole (every plan with its terms, retiring one,
// creating one), so a route that drifted to another console would show
// here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react-sdk", () => ({
  PlanCatalogConsole: () => <p>plan catalog console</p>,
}));

import PlansPage from "../page";

describe("Settings → Plans route", () => {
  it("renders the plan catalog console", () => {
    render(<PlansPage />);
    expect(screen.getByText("plan catalog console")).toBeTruthy();
  });
});
