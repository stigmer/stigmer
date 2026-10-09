/**
 * useGitHubConnection, pinned against an in-process server: "connected"
 * means My vault holds a `github.com` login, and the page never holds its
 * token.
 * - The account shown is the one the saved login's description names.
 * - Connecting is the vault's sign-in at the address `github.com`, saved in
 *   the organization's My vault: in a browser through the shared popup;
 *   with `openUrl` (a desktop shell) by opening the login page with the
 *   shell's return choice, the shell handing the code back through
 *   handleCallback.
 * - handleCallback completes the sign-in, refuses a callback this window
 *   did not start (no saved state) or a mismatched state, and after every
 *   callback, a refused one included, ends connecting and re-reads My vault.
 * - A blocked popup is reported, never thrown; reconcile re-reads My vault.
 * - A sign-in that fails, in the popup or opening the shell's browser, is
 *   reported as connectError and ends connecting; the popup is closed. A
 *   sign-in cancelled by disconnect is no failure: nothing is reported. A
 *   login page that is not an https address is never opened.
 * - Disconnect removes the `github.com` login from My vault; a removal the
 *   server refuses is reported as disconnectError, and the hook still
 *   reports connected.
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
  CompleteSignInOutputSchema,
  SignInReturn,
  StartSignInOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useGitHubConnection } from "../useGitHubConnection";

const popup = vi.hoisted(() => ({ blocked: false, declined: false, untilCancelled: false, closed: vi.fn() }));
vi.mock("../../internal/oauthPopup.js", () => ({
  openOAuthPopup: vi.fn(() => (popup.blocked ? null : { location: { href: "" }, closed: false, close: vi.fn() })),
  popupBlockedError: vi.fn(() => new Error("blocked")),
  waitForOAuthCallback: vi.fn(async (_popup: unknown, _state: string, onDispose: (dispose: () => void) => void) => {
    if (popup.untilCancelled) {
      return new Promise((_resolve, reject) => onDispose(() => reject(new Error("OAuth flow was cancelled."))));
    }
    onDispose(() => {});
    if (popup.declined) throw new Error("access_denied: the person declined");
    return { code: "code-1", state: "st-1" };
  }),
  closeOAuthPopup: popup.closed,
}));

const ORG = "org_acme";
const STATE_KEY = "stigmer:github:sign-in-state";

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
  loginPage?: string;
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
        startSignIn: (req) => {
          server.calls.push(
            `start:${req.address}:${req.vault?.org}:${req.vault?.vault.case}:${SignInReturn[req.returnTo]}:${req.loopbackPort}`,
          );
          return create(StartSignInOutputSchema, {
            authorizationUrl: server.loginPage ?? "https://github.com/login/oauth/authorize",
            state: "st-1",
          });
        },
        completeSignIn: (req) => {
          server.calls.push(`complete:${req.code}:${req.state}`);
          server.mine = vaultWith("GitHub @octocat");
          return create(CompleteSignInOutputSchema, { address: "github.com", description: "GitHub @octocat" });
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
  popup.blocked = false;
  popup.declined = false;
  popup.untilCancelled = false;
  popup.closed.mockClear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

  it("signs in at github.com through the popup, saved in My vault, and disconnects", async () => {
    const server: Server = { mine: null, reads: 0, calls: [] };
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(clientFor(server)) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isConnected).toBe(false);

    await act(async () => {
      await result.current.connect();
    });
    expect(server.calls).toEqual(["start:github.com:org_acme:mine:web:0", "complete:code-1:st-1"]);
    await waitFor(() => expect(result.current.user?.login).toBe("octocat"));
    expect(result.current.isConnecting).toBe(false);

    act(() => result.current.disconnect());
    await waitFor(() => expect(server.calls).toContain("removeConnections:mine:github.com"));
    await waitFor(() => expect(result.current.user).toBeNull());
    expect(result.current.disconnectError).toBeNull();
  });

  it("reports a blocked popup without starting a sign-in", async () => {
    popup.blocked = true;
    const server: Server = { mine: null, reads: 0, calls: [] };
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(clientFor(server)) });
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.popupBlocked).toBe(true);
    expect(server.calls).toEqual([]);
  });

  it("reports a popup sign-in that fails, closing the popup and ending connecting", async () => {
    popup.declined = true;
    const server: Server = { mine: null, reads: 0, calls: [] };
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(clientFor(server)) });
    await act(async () => {
      await expect(result.current.connect()).rejects.toThrow("access_denied");
    });
    expect(result.current.connectError?.message).toContain("access_denied");
    expect(result.current.isConnecting).toBe(false);
    expect(popup.closed).toHaveBeenCalledTimes(1);
  });

  it("reports nothing when disconnect cancels a sign-in in progress", async () => {
    popup.untilCancelled = true;
    const server: Server = { mine: null, reads: 0, calls: [] };
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(clientFor(server)) });
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.connect().catch((err: unknown) => err);
    });
    await waitFor(() => expect(result.current.isConnecting).toBe(true));
    await waitFor(() => expect(server.calls).toHaveLength(1));
    act(() => result.current.disconnect());
    expect(await pending).toBeInstanceOf(Error);
    expect(result.current.connectError).toBeNull();
    expect(result.current.isConnecting).toBe(false);
  });

  it("never opens a login page that is not an https address in the shell's browser", async () => {
    const server: Server = { mine: null, reads: 0, calls: [], loginPage: "javascript:alert(1)//" };
    const openUrl = vi.fn();
    const { result } = renderHook(() => useGitHubConnection(ORG, { openUrl }), {
      wrapper: wrapperFor(clientFor(server)),
    });
    await act(async () => {
      await expect(result.current.connect()).rejects.toThrow("The login page's address is not an https address");
    });
    expect(openUrl).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STATE_KEY)).toBeNull();
  });

  it("reports a shell that cannot open the login page, and ends connecting", async () => {
    const server: Server = { mine: null, reads: 0, calls: [] };
    const openUrl = vi.fn(async () => {
      throw new Error("no browser");
    });
    const { result } = renderHook(() => useGitHubConnection(ORG, { openUrl }), {
      wrapper: wrapperFor(clientFor(server)),
    });
    await act(async () => {
      await expect(result.current.connect()).rejects.toThrow("no browser");
    });
    expect(result.current.connectError?.message).toBe("no browser");
    expect(result.current.isConnecting).toBe(false);
    expect(server.calls).toEqual(["start:github.com:org_acme:mine:desktop:0"]);
  });

  it("opens the login page with the shell's return choice, and completes what the shell hands back", async () => {
    const server: Server = { mine: null, reads: 0, calls: [] };
    const openUrl = vi.fn();
    const { result } = renderHook(
      () => useGitHubConnection(ORG, { openUrl, returnTo: { kind: "loopback", port: 17237 } }),
      { wrapper: wrapperFor(clientFor(server)) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.connect();
    });
    expect(openUrl).toHaveBeenCalledWith("https://github.com/login/oauth/authorize");
    expect(result.current.isConnecting).toBe(true);
    expect(server.calls).toEqual(["start:github.com:org_acme:mine:loopback:17237"]);

    await act(async () => {
      await result.current.handleCallback("code-1", "st-1");
    });
    expect(server.calls).toContain("complete:code-1:st-1");
    expect(result.current.isConnecting).toBe(false);
    await waitFor(() => expect(result.current.isConnected).toBe(true));
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
  });

  it("refuses a callback with no saved state, a mismatched state, and a connect with no organization", async () => {
    const server: Server = { mine: null, reads: 0, calls: [] };
    const wrapper = wrapperFor(clientFor(server));
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper });
    await expect(result.current.handleCallback("c", "s")).rejects.toThrow(/not started here, or it already finished/);
    sessionStorage.setItem(STATE_KEY, "expected");
    await expect(result.current.handleCallback("c", "other")).rejects.toThrow(/does not match/);

    const noOrg = renderHook(() => useGitHubConnection(null), { wrapper });
    await expect(noOrg.result.current.connect()).rejects.toThrow(/without an organization/);
    expect(noOrg.result.current.readOrg).toBeNull();
    expect(server.calls).toEqual([]);
  });

  it("ends connecting and re-reads My vault after a callback it refuses, and on reconcile", async () => {
    const server: Server = { mine: null, reads: 0, calls: [] };
    const openUrl = vi.fn();
    const { result } = renderHook(() => useGitHubConnection(ORG, { openUrl }), {
      wrapper: wrapperFor(clientFor(server)),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.isConnecting).toBe(true);
    expect(server.calls).toEqual(["start:github.com:org_acme:mine:desktop:0"]);

    // The sign-in finished in another window, which cleared the state.
    sessionStorage.clear();
    server.mine = vaultWith("GitHub @hubber");
    const before = server.reads;
    await act(async () => {
      await expect(result.current.handleCallback("c", "st-1")).rejects.toThrow(/not started here, or it already finished/);
    });
    expect(result.current.isConnecting).toBe(false);
    await waitFor(() => expect(server.reads).toBeGreaterThan(before));
    await waitFor(() => expect(result.current.user?.login).toBe("hubber"));

    const beforeReconcile = server.reads;
    act(() => result.current.reconcile());
    await waitFor(() => expect(server.reads).toBeGreaterThan(beforeReconcile));
  });
});
