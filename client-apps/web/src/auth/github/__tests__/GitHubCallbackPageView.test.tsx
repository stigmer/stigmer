// ---------------------------------------------------------------------------
// GitHubCallbackPageView — the GitHub code is redeemed once, and only with
// its state, for the org the visitor is in
//
// GitHub sends the visitor back here with a one-time `code` and the `state`
// the console sent out. The view must refuse to redeem without both, wait
// until the active org and the connection hook are ready (the token is
// written into that org's personal environment), redeem exactly once, and
// then either hand control back to the popup's opener on this origin only,
// or go home. A failure is shown, never swallowed.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => nav.params,
}));

const github = vi.hoisted(() => ({
  org: "acme" as string | null,
  isLoading: false,
  handleCallback: vi.fn(
    async (_code: string, _state: string, _redirectUri: string) => {},
  ),
}));

vi.mock("@stigmer/react", () => ({
  GITHUB_CALLBACK_MESSAGE_TYPE: "stigmer:github:callback-success",
  useActiveOrgSlug: () => github.org,
  useGitHubConnection: () => ({
    handleCallback: github.handleCallback,
    isLoading: github.isLoading,
  }),
}));

import { GitHubCallbackPageView } from "../GitHubCallbackPageView";

const REDIRECT_URI = `${window.location.origin}/auth/github/callback`;

function setOpener(
  opener: { closed: boolean; postMessage: ReturnType<typeof vi.fn> } | null,
) {
  Object.defineProperty(window, "opener", {
    value: opener,
    configurable: true,
    writable: true,
  });
}

describe("GitHubCallbackPageView", () => {
  beforeEach(() => {
    nav.params = new URLSearchParams("code=gh-code&state=gh-state");
    nav.replace.mockReset();
    github.org = "acme";
    github.isLoading = false;
    github.handleCallback.mockReset();
    github.handleCallback.mockResolvedValue(undefined);
    setOpener(null);
  });

  afterEach(() => {
    setOpener(null);
    vi.restoreAllMocks();
  });

  it.each([
    ["no code", "state=gh-state"],
    ["no state", "code=gh-code"],
    ["neither", ""],
  ])("refuses to redeem with %s and says what is missing", (_label, query) => {
    nav.params = new URLSearchParams(query);
    render(<GitHubCallbackPageView />);

    expect(
      screen.getByText("Missing authorization code or state parameter"),
    ).toBeTruthy();
    expect(github.handleCallback).not.toHaveBeenCalled();
  });

  it("waits for the active org before redeeming", () => {
    github.org = null;
    render(<GitHubCallbackPageView />);

    expect(screen.getByText("Connecting your GitHub account...")).toBeTruthy();
    expect(github.handleCallback).not.toHaveBeenCalled();
  });

  it("waits for the connection hook to finish loading before redeeming", () => {
    github.isLoading = true;
    render(<GitHubCallbackPageView />);

    expect(github.handleCallback).not.toHaveBeenCalled();
  });

  it("redeems the code once with its state and this console's callback URL, then goes home", async () => {
    const { rerender } = render(<GitHubCallbackPageView />);
    rerender(<GitHubCallbackPageView />);

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/"));
    expect(github.handleCallback).toHaveBeenCalledTimes(1);
    expect(github.handleCallback).toHaveBeenCalledWith(
      "gh-code",
      "gh-state",
      REDIRECT_URI,
    );
  });

  it("in a popup, signals the opener on this origin only and closes instead of navigating", async () => {
    const opener = { closed: false, postMessage: vi.fn() };
    setOpener(opener);
    const close = vi.spyOn(window, "close").mockImplementation(() => {});

    render(<GitHubCallbackPageView />);

    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: "stigmer:github:callback-success" },
      window.location.origin,
    );
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("treats a closed opener as a full-page visit", async () => {
    setOpener({ closed: true, postMessage: vi.fn() });
    render(<GitHubCallbackPageView />);

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/"));
  });

  it("shows the redemption's error message and offers the way home", async () => {
    github.handleCallback.mockRejectedValue(new Error("state mismatch"));
    render(<GitHubCallbackPageView />);

    await waitFor(() =>
      expect(screen.getByText("state mismatch")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Back to Home" })).toBeTruthy();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("names the failure itself when the rejection is not an Error", async () => {
    github.handleCallback.mockRejectedValue("boom");
    render(<GitHubCallbackPageView />);

    await waitFor(() =>
      expect(screen.getByText("Failed to connect GitHub account")).toBeTruthy(),
    );
  });
});
