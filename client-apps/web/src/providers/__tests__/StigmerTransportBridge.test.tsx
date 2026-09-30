// ---------------------------------------------------------------------------
// StigmerTransportBridge — the console's session reaches every RPC, and a
// rejected session signs the visitor out
//
// The bridge builds the one SDK client the authenticated console uses. Two
// promises ride on it, and both are proven here through the real SDK
// transport over a stubbed fetch, not a mocked client:
//
//   1. Every call carries the live access token as a bearer, and after the
//      token changes (a silent renewal) the next call carries the new one.
//   2. A call the server rejects as UNAUTHENTICATED (gRPC code 16) calls the
//      session's `logout`, so an expired or revoked session never leaves the
//      visitor on a console that fails every request.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { AuthContext } from "@/auth/context";
import type { AuthState } from "@/auth/types";

const API = "https://api.example.test";

const auth = {
  accessToken: "token-1" as string | null,
  logout: vi.fn(),
};

vi.mock("@/config/env", () => ({
  getApiBaseUrl: () => API,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

const provider = vi.hoisted(() => ({
  clients: [] as Stigmer[],
}));

// The bridge takes only the provider from @stigmer/react; capture the client
// it hands over instead of mounting the whole SDK tree.
vi.mock("@stigmer/react", () => ({
  StigmerProvider: ({
    client,
    children,
  }: {
    client: Stigmer;
    children: React.ReactNode;
  }) => {
    provider.clients.push(client);
    return <>{children}</>;
  },
}));

import { StigmerTransportBridge } from "../StigmerTransportBridge";

// The real auth context, carrying the session the test controls.
function Session({ children }: { children: React.ReactNode }) {
  const state: AuthState = {
    isAuthenticated: true,
    isLoading: false,
    user: null,
    accessToken: auth.accessToken,
    login: () => {},
    logout: auth.logout,
  };
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

function bridge() {
  return (
    <Session>
      <StigmerTransportBridge>
        <p>app</p>
      </StigmerTransportBridge>
    </Session>
  );
}

interface SeenCall {
  url: string;
  authorization: string | null;
}

let seen: SeenCall[] = [];
let answerUnauthenticated = true;

function grpcWebAnswer(): Response {
  // A trailers-only gRPC-Web answer: the status travels in the headers.
  return new Response(null, {
    status: 200,
    headers: answerUnauthenticated
      ? {
          "content-type": "application/grpc-web+proto",
          "grpc-status": "16",
          "grpc-message": "token expired",
        }
      : {
          "content-type": "application/grpc-web+proto",
          "grpc-status": "5",
          "grpc-message": "not found",
        },
  });
}

describe("StigmerTransportBridge", () => {
  beforeEach(() => {
    seen = [];
    answerUnauthenticated = true;
    auth.accessToken = "token-1";
    auth.logout.mockReset();
    provider.clients = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen.push({
          url: String(input instanceof Request ? input.url : input),
          authorization: headers.get("authorization"),
        });
        return grpcWebAnswer();
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the live access token as a bearer to the configured API", async () => {
    answerUnauthenticated = false;
    render(bridge());

    // The bridge's deployment-mode probe is the first call it makes.
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.url.startsWith(`${API}/`)).toBe(true);
    expect(seen[0]?.authorization).toBe("Bearer token-1");
  });

  it("carries the renewed token on the next call after the session's token changes", async () => {
    answerUnauthenticated = false;
    const { rerender } = render(bridge());
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));

    auth.accessToken = "token-2";
    rerender(bridge());
    seen = [];

    // The rebuilt client re-runs the deployment-mode probe, and a direct call
    // follows it: every call after the renewal carries the new token.
    const latest = provider.clients.at(-1);
    expect(latest).toBeDefined();
    await (latest as Stigmer).platform.getServerInfo().catch(() => {});
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((call) => call.authorization))).toEqual(
      new Set(["Bearer token-2"]),
    );
  });

  it("sends no Authorization header when the session has no token", async () => {
    answerUnauthenticated = false;
    auth.accessToken = null;
    render(bridge());

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.authorization).toBeNull();
  });

  it("signs the visitor out when the server rejects the session as unauthenticated", async () => {
    render(bridge());

    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
  });

  it("does not sign the visitor out for any other failure", async () => {
    answerUnauthenticated = false;
    render(bridge());

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const client = provider.clients.at(-1) as Stigmer;
    await client.platform.getServerInfo().catch(() => {});
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
