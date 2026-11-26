// ---------------------------------------------------------------------------
// The shared sign-in callback page routes each return to its finisher:
//
//   - `source=desktop`: the code and state go on to Stigmer Desktop's deep
//     link, the login page's error with them, and after a moment the page
//     keeps Open Stigmer Desktop in case the app didn't open;
//   - a return whose state is the one a Connect link this tab started
//     with: the link's completion, whether or not the window has an opener
//     (an integrator may open the link in a window of its own);
//   - otherwise the sign-in's return, which hands the answer to Stigmer, a
//     link pending for another state included;
//   - a Connect link's completion and a sign-in's hand-back reach the
//     server with no token: both calls are public;
//   - the static export prerenders nothing of the page.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/config/env", () => ({ getApiBaseUrl: () => "https://api.example.test" }));

const link = vi.hoisted(() => ({ token: null as string | null, state: "st" }));
const sdkClient = vi.hoisted(() => ({ options: [] as Array<{ getAccessToken: () => unknown }> }));
vi.mock("@stigmer/client", () => ({
  Stigmer: class {
    constructor(options: { getAccessToken: () => unknown }) {
      sdkClient.options.push(options);
    }
  },
}));
vi.mock("@stigmer/react-sdk", () => ({
  SignInReturn: () => <p>sign-in return</p>,
  ConnectLinkCallback: ({ token }: { token: string }) => <p>connect link {token}</p>,
  StigmerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  pendingConnectLinkToken: (state: string | null) => (state === link.state ? link.token : null),
}));

import OAuthCallbackPage from "../page";

beforeEach(() => {
  search.value = "";
  link.token = null;
  link.state = "st";
  sdkClient.options = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the sign-in callback page", () => {
  it("hands a desktop sign-in to the app's deep link", async () => {
    search.value = "?source=desktop&code=c-1&state=st&error=access_denied";
    const location = { href: "https://console.example/auth/oauth/callback" };
    vi.stubGlobal("location", location);
    render(<OAuthCallbackPage />);
    await waitFor(() =>
      expect(location.href).toBe("stigmer://oauth/callback?code=c-1&state=st&error=access_denied"),
    );
    expect(screen.getByText("Going back to Stigmer Desktop\u2026")).toBeTruthy();
  });

  it("keeps the way back to Stigmer Desktop when the app didn't open", async () => {
    vi.useFakeTimers();
    try {
      search.value = "?source=desktop&code=c-1&state=st";
      vi.stubGlobal("location", { href: "https://console.example/auth/oauth/callback" });
      render(<OAuthCallbackPage />);
      expect(screen.getByText("Going back to Stigmer Desktop\u2026")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByRole("heading", { name: "You're signed in" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open Stigmer Desktop" }).getAttribute("href")).toBe(
        "stigmer://oauth/callback?code=c-1&state=st",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("finishes a Connect link this tab started", async () => {
    search.value = "?code=c-1&state=st";
    link.token = "tok";
    render(<OAuthCallbackPage />);
    expect(await screen.findByText("connect link tok")).toBeTruthy();
    expect(sdkClient.options.map((options) => options.getAccessToken())).toEqual([null]);
  });

  it("finishes a Connect link opened in an integrator's window: the state decides, not the opener", async () => {
    search.value = "?code=c-1&state=st";
    link.token = "tok";
    vi.stubGlobal("opener", { closed: false, postMessage: () => {} });
    render(<OAuthCallbackPage />);
    expect(await screen.findByText("connect link tok")).toBeTruthy();
  });

  it("hands a sign-in's return to Stigmer while a link waits for another state", async () => {
    search.value = "?code=c-1&state=popup-state";
    link.token = "tok";
    render(<OAuthCallbackPage />);
    expect(await screen.findByText("sign-in return")).toBeTruthy();
  });

  it("prerenders nothing: the return is decided in the browser", () => {
    search.value = "?code=c-1&state=st";
    // Only React's Suspense markers: no element, no text.
    const host = document.createElement("div");
    host.innerHTML = renderToString(<OAuthCallbackPage />);
    expect(host.children).toHaveLength(0);
    expect(host.textContent).toBe("");
  });

  it("hands anything else to Stigmer with no token: the hand-back is public", async () => {
    search.value = "?code=c-1&state=st";
    render(<OAuthCallbackPage />);
    expect(await screen.findByText("sign-in return")).toBeTruthy();
    expect(sdkClient.options.map((options) => options.getAccessToken())).toEqual([null]);
  });
});
