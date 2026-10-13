// ---------------------------------------------------------------------------
// The /login route — renders the console's sign-in view
//
// The page is the route's whole job: it hands /login to LoginPageView, the
// deployment's one sign-in, so a route that drifted to another view would
// show here. The view's behaviour is pinned by its own suite
// (auth/login/__tests__/LoginPageView.test.tsx).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/auth/login/LoginPageView", () => ({
  LoginPageView: () => <p>sign-in view</p>,
}));

import LoginPage from "../page";

describe("/login route", () => {
  it("renders the sign-in view", () => {
    render(<LoginPage />);
    expect(screen.getByText("sign-in view")).toBeTruthy();
  });
});
