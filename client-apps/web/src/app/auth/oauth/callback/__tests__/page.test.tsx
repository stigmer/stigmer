// ---------------------------------------------------------------------------
// The shared sign-in callback page routes each return to its finisher:
//
//   - `source=desktop`: the code and state go on to Stigmer Desktop's deep
//     link, the login page's error with them;
//   - no opener and a Connect link this tab started: the link's completion;
//   - otherwise the popup handler; an opener the page may not read
//     (another origin's window) counts as none;
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

const link = vi.hoisted(() => ({ token: null as string | null }));
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
  pendingConnectLinkToken: () => link.token,
}));

import OAuthCallbackPage from "../page";

beforeEach(() => {
  search.value = "";
  link.token = null;
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

  it("reads an opener it may not touch as none: a Connect link this tab started still finishes", async () => {
    search.value = "?code=c-1&state=st";
    link.token = "tok";
    const opener = Object.getOwnPropertyDescriptor(window, "opener");
    Object.defineProperty(window, "opener", {
      configurable: true,
      get() {
        throw new DOMException("Blocked a frame with origin", "SecurityError");
      },
    });
    try {
      render(<OAuthCallbackPage />);
      expect(await screen.findByText("connect link tok")).toBeTruthy();
    } finally {
      if (opener !== undefined) Object.defineProperty(window, "opener", opener);
    }
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
