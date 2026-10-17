// ---------------------------------------------------------------------------
// The Settings → Model catalog route — renders the React SDK's catalog console
//
// The page is the route's whole job: it hands Settings → Model catalog to
// ModelCatalogConsole (the catalog's models and prices, with the detail,
// edit, add and retire steps), so a route that drifted to another console
// would show here. The console's behaviour is pinned by its own suite in
// sdk/react.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react-sdk", () => ({
  ModelCatalogConsole: () => <p>model catalog console</p>,
}));

import ModelCatalogPage from "../page";

describe("Settings → Model catalog route", () => {
  it("renders the model catalog console", () => {
    render(<ModelCatalogPage />);
    expect(screen.getByText("model catalog console")).toBeTruthy();
  });
});
