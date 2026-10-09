// ---------------------------------------------------------------------------
// The shared sign-in callback page routes each return to its finisher:
//
//   - `source=desktop`: the code and state go on to Stigmer Desktop's deep
//     link, the login page's error with them;
//   - no opener and a Connect link this tab started: the link's completion;
//   - otherwise the popup handler.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/config/env", () => ({ getApiBaseUrl: () => "https://api.example.test" }));

const link = vi.hoisted(() => ({ token: null as string | null }));
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
  });

  it("hands anything else to the popup handler", async () => {
    search.value = "?code=c-1&state=st";
    render(<OAuthCallbackPage />);
    expect(await screen.findByText("popup handler")).toBeTruthy();
  });
});
