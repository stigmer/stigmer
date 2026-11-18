// ---------------------------------------------------------------------------
// The desktop router's own states: nothing at this address, and a page that
// broke while it drew
//
// RouteNotFound is the `*` route; RouteFailure is the shell's errorElement.
// The router's error and navigate are the test's. Pinned: a 404 the router
// raises reads as nothing at this address; anything else thrown reads as a
// page that broke, a thrown non-Error included; Try again reloads the route.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const router = vi.hoisted(() => ({ error: null as unknown, navigate: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useRouteError: () => router.error,
  useNavigate: () => router.navigate,
}));

import { RouteFailure, RouteNotFound } from "../RouteStates";

function renderInRouter(node: React.ReactNode): void {
  render(<MemoryRouter>{node}</MemoryRouter>);
}

afterEach(() => {
  cleanup();
  router.error = null;
  router.navigate.mockReset();
});

describe("the desktop router's states", () => {
  it("says there is nothing at an address that leads nowhere, with a way to the dashboard", () => {
    renderInRouter(<RouteNotFound />);
    expect(screen.getByText("There's nothing at this address")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the dashboard" }).getAttribute("href")).toBe("/dashboard");
  });

  it("reads the router's own 404 as nothing at this address", () => {
    router.error = { status: 404, statusText: "Not Found", internal: true, data: "" };
    renderInRouter(<RouteFailure />);
    expect(screen.getByText("There's nothing at this address")).toBeTruthy();
  });

  it("says a page broke when something other than an Error was thrown, and reloads the route on Try again", () => {
    router.error = "the page threw a string";
    renderInRouter(<RouteFailure />);
    expect(screen.getByRole("alert").textContent).toContain("the page threw a string");

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(router.navigate).toHaveBeenCalledWith(0);
  });
});
