// ---------------------------------------------------------------------------
// The GitHub callback route — a desktop-started sign-in goes back to the app
//
// Stigmer Desktop starts its GitHub authorization in the system browser with
// `source=desktop`, so GitHub lands here, in the web console, which holds no
// desktop session. The route must hand the code and state to the app through
// the `stigmer://github/callback` deep link, encoded so neither value can
// smuggle extra parameters in, and must not run the console's own exchange.
// Every other visit goes to the console's callback view.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
}));

vi.mock("@/auth/github/GitHubCallbackPageView", () => ({
  GitHubCallbackPageView: () => <p>console callback view</p>,
}));

import GitHubCallbackPage from "../page";

let assigned: string[] = [];

describe("GitHub callback route", () => {
  beforeEach(() => {
    assigned = [];
    // happy-dom would try to navigate on an href assignment; record it.
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      set href(value: string) {
        assigned.push(value);
      },
      get href() {
        return "http://localhost:3000/auth/github/callback";
      },
    } as Location);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the console's own callback view for a console-started sign-in", () => {
    nav.params = new URLSearchParams("code=c&state=s");
    render(<GitHubCallbackPage />);

    expect(screen.getByText("console callback view")).toBeTruthy();
    expect(assigned).toEqual([]);
  });

  it("hands a desktop-started sign-in to the app through the deep link, and runs no console exchange", () => {
    nav.params = new URLSearchParams(
      "source=desktop&code=gh-code&state=gh-state",
    );
    render(<GitHubCallbackPage />);

    expect(assigned).toEqual([
      "stigmer://github/callback?code=gh-code&state=gh-state",
    ]);
    expect(screen.getByText("Redirecting to Stigmer Desktop...")).toBeTruthy();
    expect(screen.queryByText("console callback view")).toBeNull();
  });

  it("encodes the code and state so neither can add parameters to the deep link", () => {
    nav.params = new URLSearchParams();
    nav.params.set("source", "desktop");
    nav.params.set("code", "a&state=forged");
    nav.params.set("state", "s p/ace");
    render(<GitHubCallbackPage />);

    expect(assigned).toEqual([
      "stigmer://github/callback?code=a%26state%3Dforged&state=s%20p%2Face",
    ]);
  });

  it.each([
    ["no code", "source=desktop&state=s"],
    ["no state", "source=desktop&code=c"],
  ])("opens no deep link with %s and says what is missing", (_label, query) => {
    nav.params = new URLSearchParams(query);
    render(<GitHubCallbackPage />);

    expect(assigned).toEqual([]);
    expect(
      screen.getByText("Missing authorization code or state parameter."),
    ).toBeTruthy();
  });
});
