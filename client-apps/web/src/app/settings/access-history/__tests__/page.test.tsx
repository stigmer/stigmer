// ---------------------------------------------------------------------------
// The Settings → Access history route — renders the React SDK's section
//
// The page is the route's whole job: it hands Settings → Access history to
// AccessHistorySection (who gave whom access to what, and the download), so
// a route that drifted to another section would show here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react-sdk/console", () => ({
  AccessHistorySection: () => <p>access history section</p>,
}));

import AccessHistoryPage from "../page";

describe("Settings → Access history route", () => {
  it("renders the access history section", () => {
    render(<AccessHistoryPage />);
    expect(screen.getByText("access history section")).toBeTruthy();
  });
});
