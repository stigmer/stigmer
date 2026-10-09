// ---------------------------------------------------------------------------
// The shared sign-in callback page routes each return to its finisher:
//
//   - `source=desktop`: the code and state go on to Stigmer Desktop's deep
//     link, the login page's error with them;
//   - a return whose state is the one a Connect link this tab started
//     with: the link's completion, whether or not the window has an opener
//     (an integrator may open the link in a window of its own);
//   - otherwise the popup handler, a link pending for another state
//     included;
//   - a Connect link's completion reaches the server with no token: the
//     call is public;
//   - the static export prerenders nothing of the page.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/config/env", () => ({ getApiBaseUrl: () => "https://api.example.test" }));

const link = vi.hoisted(() => ({ token: null as string | null, state: "st" }));
const sdkClient = vi.hoisted(() => ({ options: [] as Array<{ getAccessToken: () => unknown }> }));
vi.mock("@stigmer/sdk", () => ({
  Stigmer: class {
    constructor(options: { getAccessToken: () => unknown }) {
      sdkClient.options.push(options);
    }
  },
}));
vi.mock("@stigmer/react", () => ({
  OAuthCallbackHandler: () => <p>popup handler</p>,
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
    expect(screen.getByText("Returning to Stigmer Desktop...")).toBeTruthy();
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

  it("hands a popup's return to the popup handler while a link waits for another state", async () => {
    search.value = "?code=c-1&state=popup-state";
    link.token = "tok";
    render(<OAuthCallbackPage />);
    expect(await screen.findByText("popup handler")).toBeTruthy();
  });

  it("prerenders nothing: the return is decided in the browser", () => {
    search.value = "?code=c-1&state=st";
    // Only React's Suspense markers: no text, no handler.
    expect(renderToString(<OAuthCallbackPage />).replace(/<!--.*?-->/g, "")).toBe("");
  });

  it("hands anything else to the popup handler", async () => {
    search.value = "?code=c-1&state=st";
    render(<OAuthCallbackPage />);
    expect(await screen.findByText("popup handler")).toBeTruthy();
  });
});
