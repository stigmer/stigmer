/**
 * useGitHubConnection, pinned against an in-process server: "connected"
 * means My vault holds a `github.com` login, and the page never holds its
 * token.
 * - The account shown is the one the saved login's description names, else
 *   the one the browser remembered from the exchange, per organization.
 * - Connect asks for the authorize URL for the organization whose My vault
 *   will keep the login.
 * - The callback exchanges the code with that organization, refuses a
 *   callback this browser did not start (no saved state), a mismatched
 *   state and a missing organization, and after every callback, a refused
 *   one included, ends connecting and re-reads My vault.
 * - A popup's success message and its closing re-read My vault; reconcile
 *   does too.
 * - Disconnect removes the `github.com` login from My vault and forgets the
 *   account; a removal the server refuses is reported as disconnectError,
 *   and the hook still reports connected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { VaultSchema, type Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import {
  ExchangeOAuthCodeResponseSchema,
  GetOAuthAuthorizeUrlResponseSchema,
  GitHubService,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { GITHUB_CALLBACK_MESSAGE_TYPE, useGitHubConnection } from "../useGitHubConnection";

const ORG = "org_acme";

function vaultWith(description: string | null): Vault {
  return create(VaultSchema, {
    metadata: { id: "vlt_mine", org: ORG, name: "My vault" },
    spec: {
      owner: { case: "person", value: "ida_ana" },
      ...(description === null ? {} : { connections: { "github.com": { token: "", description } } }),
    },
  });
}

interface Server {
  mine: Vault | null;
  reads: number;
  calls: string[];
  refuseRemove?: boolean;
}

function clientFor(server: Server) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(VaultQueryController, {
        getMine: () => {
          server.reads += 1;
          if (!server.mine) throw new ConnectError("none yet", Code.NotFound);
          return server.mine;
        },
      });
      service(VaultCommandController, {
        removeConnections: (req) => {
          server.calls.push(`removeConnections:${req.vault?.vault.case}:${req.addresses.join(",")}`);
          if (server.refuseRemove) throw new ConnectError("vault unavailable", Code.Unavailable);
          server.mine = vaultWith(null);
          return server.mine;
        },
      });
      service(GitHubService, {
        getOAuthAuthorizeUrl: (req) => {
          server.calls.push(`authorize:${req.redirectUri}:${req.org}`);
          return create(GetOAuthAuthorizeUrlResponseSchema, { authorizeUrl: "https://github.com/login/oauth/authorize", state: "st-1" });
        },
        exchangeOAuthCode: (req) => {
          server.calls.push(`exchange:${req.code}:${req.org}`);
          server.mine = vaultWith("GitHub");
          return create(ExchangeOAuthCodeResponseSchema, { login: "octocat", scope: "repo" });
        },
      });
    }),
  });
}

function wrapperFor(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useGitHubConnection", () => {
  it("shows the account the saved login names, connected only while My vault holds it", async () => {
    const server: Server = { mine: vaultWith("GitHub @octocat"), reads: 0, calls: [] };
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(clientFor(server)) });
    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(result.current.user).toEqual({
      login: "octocat",
      avatarUrl: "https://github.com/octocat.png",
      name: null,
    });
    expect(result.current.readOrg).toBe(ORG);
  });

  it("exchanges the code with the organization, remembers the account, and disconnects", async () => {
    const server: Server = { mine: null, reads: 0, calls: [] };
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(clientFor(server)) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isConnected).toBe(false);

    sessionStorage.setItem("stigmer:github:oauth-state", "st-1");
    await act(async () => {
      await result.current.handleCallback("code-1", "st-1", "https://app/cb");
    });
    expect(server.calls).toEqual(["exchange:code-1:org_acme"]);
    await waitFor(() => expect(result.current.isConnected).toBe(true));
    // The saved description names no account: the remembered one is shown.
    expect(result.current.user?.login).toBe("octocat");
    expect(localStorage.length, "nothing about the account is kept in the browser").toBe(0);

    act(() => result.current.disconnect());
    await waitFor(() => expect(server.calls).toContain("removeConnections:mine:github.com"));
    expect(result.current.user).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(result.current.disconnectError).toBeNull();
  });

  it("reports a disconnect the server refuses, still connected, and clears it on the next attempt", async () => {
    const server: Server = { mine: vaultWith("GitHub @octocat"), reads: 0, calls: [], refuseRemove: true };
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(clientFor(server)) });
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    act(() => result.current.disconnect());
    await waitFor(() => expect(result.current.disconnectError).not.toBeNull());
    expect(result.current.disconnectError?.message).toContain("vault unavailable");
    expect(result.current.isConnected).toBe(true);

    server.refuseRemove = false;
    act(() => result.current.disconnect());
    expect(result.current.disconnectError).toBeNull();
    await waitFor(() => expect(result.current.isConnected).toBe(false));
    expect(result.current.disconnectError).toBeNull();
  });

  it("refuses a callback with no saved state, a mismatched state and an exchange with no organization", async () => {
    const server: Server = { mine: null, reads: 0, calls: [] };
    const wrapper = wrapperFor(clientFor(server));
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper });
    await expect(result.current.handleCallback("c", "s", "r")).rejects.toThrow(
      /not started here, or it already finished/,
    );
    sessionStorage.setItem("stigmer:github:oauth-state", "expected");
    await expect(result.current.handleCallback("c", "other", "r")).rejects.toThrow(/state mismatch/);
    // A refused state is left in place for the real callback; clear it here.
    sessionStorage.clear();

    const noOrg = renderHook(() => useGitHubConnection(null), { wrapper });
    await expect(noOrg.result.current.connect("r")).rejects.toThrow(/without an organization/);
    sessionStorage.setItem("stigmer:github:oauth-state", "s");
    await expect(noOrg.result.current.handleCallback("c", "s", "r")).rejects.toThrow(/without an organization/);
    expect(noOrg.result.current.readOrg).toBeNull();
    expect(server.calls).toEqual([]);
  });

  it("ends connecting and re-reads My vault after a callback it refuses", async () => {
    const server: Server = { mine: null, reads: 0, calls: [] };
    const openUrl = vi.fn();
    const { result } = renderHook(() => useGitHubConnection(ORG, { openUrl }), {
      wrapper: wrapperFor(clientFor(server)),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.connect("https://app/cb", { popup: true });
    });
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(result.current.isConnecting).toBe(true);

    // The sign-in finished in another window, which cleared the state.
    sessionStorage.clear();
    server.mine = vaultWith("GitHub @hubber");
    const before = server.reads;
    await act(async () => {
      await expect(result.current.handleCallback("c", "st-1", "r")).rejects.toThrow(
        /not started here, or it already finished/,
      );
    });
    expect(result.current.isConnecting).toBe(false);
    await waitFor(() => expect(server.reads).toBeGreaterThan(before));
    await waitFor(() => expect(result.current.user?.login).toBe("hubber"));
    expect(server.calls).toEqual(["authorize:https://app/cb:org_acme"]);
  });

  it("re-reads My vault on a popup's success message, when its popup closes, and on reconcile", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server: Server = { mine: null, reads: 0, calls: [] };
    const popup = { closed: false, focus: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(clientFor(server)) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.connect("https://app/cb", { popup: true });
    });
    expect(server.calls).toEqual(["authorize:https://app/cb:org_acme"]);
    expect(sessionStorage.getItem("stigmer:github:oauth-state")).toBe("st-1");
    expect(result.current.isConnecting).toBe(true);
    server.mine = vaultWith("GitHub @hubber");
    const before = server.reads;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: GITHUB_CALLBACK_MESSAGE_TYPE, login: "hubber" },
        }),
      );
    });
    await waitFor(() => expect(server.reads).toBeGreaterThan(before));
    expect(result.current.isConnecting).toBe(false);
    await waitFor(() => expect(result.current.user?.login).toBe("hubber"));

    await act(async () => {
      await result.current.connect("https://app/cb", { popup: true });
    });
    const beforeClose = server.reads;
    popup.closed = true;
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await waitFor(() => expect(server.reads).toBeGreaterThan(beforeClose));
    expect(result.current.isConnecting).toBe(false);

    const beforeReconcile = server.reads;
    act(() => result.current.reconcile());
    await waitFor(() => expect(server.reads).toBeGreaterThan(beforeReconcile));
  });

  it("forgets the account an exchange answered when the organization changes", async () => {
    const server: Server = { mine: null, reads: 0, calls: [] };
    const { result, rerender } = renderHook(({ org }) => useGitHubConnection(org), {
      wrapper: wrapperFor(clientFor(server)),
      initialProps: { org: ORG },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    sessionStorage.setItem("stigmer:github:oauth-state", "st-1");
    await act(async () => {
      await result.current.handleCallback("code-1", "st-1", "https://app/cb");
    });
    await waitFor(() => expect(result.current.user?.login).toBe("octocat"));
    rerender({ org: "org_other" });
    await waitFor(() => expect(result.current.user).toBeNull());
  });

  it("keeps working when the browser refuses storage", async () => {
    sessionStorage.setItem("stigmer:github:oauth-state", "s");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const server: Server = { mine: null, reads: 0, calls: [] };
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(clientFor(server)) });
    await act(async () => {
      await result.current.handleCallback("c", "s", "r");
    });
    expect(server.calls).toEqual(["exchange:c:org_acme"]);
  });
});
