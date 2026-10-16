// ---------------------------------------------------------------------------
// The Settings → Licenses route — renders the React SDK's licenses console
//
// The page is the route's whole job: it hands the operator-gated Licenses
// entry to LicensesConsole (the renewal calendar, the issue form, each
// license's signed ticket), so a route that drifted to another console
// would show here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react-sdk", () => ({
  LicensesConsole: () => <p>licenses console</p>,
}));

import LicensesPage from "../page";

describe("Settings → Licenses route", () => {
  it("renders the licenses console", () => {
    render(<LicensesPage />);
    expect(screen.getByText("licenses console")).toBeTruthy();
  });
});
