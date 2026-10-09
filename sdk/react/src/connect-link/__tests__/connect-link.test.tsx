/**
 * The Connect link's page and its callback, against an in-process server:
 * - the page says what the link is for and, on Continue, keeps the link's
 *   secret with the state its sign-in started with for the callback page
 *   and sends the browser to the login page; a login page that is not an
 *   https address is never visited;
 * - a link the server no longer knows (unknown, expired or used) says so,
 *   and offers nothing to click;
 * - the pending link answers only for the state it started with;
 * - the callback page hands the login page's code, state or error to the
 *   server with the link's secret, forgets the secret, and sends the
 *   browser to the URL the server answers; a dead link says so and is
 *   forgotten; a failure on the way keeps it, so a reload tries again;
 * - a start the server refuses for another reason says why and stays on
 *   the page; a hook with no link starts nothing; a tab whose storage
 *   cannot be read has no pending link; and the callback completes once
 *   even when React runs its effect twice (StrictMode).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import {
  CompleteConnectLinkOutputSchema,
  ConnectLinkController,
  ConnectLinkInfoSchema,
  StartConnectLinkOutputSchema,
  type CompleteConnectLinkInput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ConnectLinkCallback } from "../ConnectLinkCallback";
import { ConnectLinkView } from "../ConnectLinkView";
import { CONNECT_LINK_PENDING_KEY, pendingConnectLinkToken, useConnectLink } from "../useConnectLink";

const TOKEN = "tok-123";

/** What Continue keeps for the callback page: the link's secret and its sign-in's state. */
function keepPendingLink(): void {
  sessionStorage.setItem(CONNECT_LINK_PENDING_KEY, JSON.stringify({ token: TOKEN, state: "st" }));
}

interface World {
  readonly dead: boolean;
  readonly startRefused?: boolean;
  readonly loginPage?: string;
  readonly completeUnavailable?: boolean;
  readonly completed: CompleteConnectLinkInput[];
}

function providers(world: World) {
  const client = new Stigmer({
    baseUrl: "/",
    customTransport: createRouterTransport(({ service }) => {
      service(ConnectLinkController, {
        getConnectLink: () => {
          if (world.dead) throw new ConnectError("Connect link not found", Code.NotFound);
          return create(ConnectLinkInfoSchema, {
            providerName: "Slack",
            address: "https://mcp.slack.com/mcp",
            organizationName: "Acme Helpdesk",
          });
        },
        startConnectLink: () => {
          if (world.startRefused === true) {
            throw new ConnectError("nothing can sign in to https://mcp.slack.com/mcp", Code.FailedPrecondition);
          }
          return create(StartConnectLinkOutputSchema, {
            authorizationUrl: world.loginPage ?? "https://slack.com/oauth/authorize?x=1",
            state: "st",
          });
        },
        completeConnectLink: (input) => {
          world.completed.push(input);
          if (world.dead) throw new ConnectError("Connect link not found", Code.NotFound);
          if (world.completeUnavailable === true) throw new ConnectError("upstream connect error", Code.Unavailable);
          return create(CompleteConnectLinkOutputSchema, {
            returnUrl: "https://helpdesk.example/done?stigmer_connect=connected",
          });
        },
      });
    }),
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

const assign = vi.fn();
const replace = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  assign.mockReset();
  replace.mockReset();
  vi.stubGlobal("location", { ...window.location, assign, replace, search: "?code=c-1&state=st" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConnectLinkView", () => {
  it("says what the link is for and, on Continue, keeps the secret and goes to the login page", async () => {
    const world: World = { dead: false, completed: [] };
    render(<ConnectLinkView token={TOKEN} />, { wrapper: providers(world) });
    expect(await screen.findByText("Connect Slack for Acme Helpdesk")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://slack.com/oauth/authorize?x=1"));
    expect(JSON.parse(sessionStorage.getItem(CONNECT_LINK_PENDING_KEY) ?? "null")).toEqual({ token: TOKEN, state: "st" });
    expect(pendingConnectLinkToken("st")).toBe(TOKEN);
    expect(pendingConnectLinkToken("another-sign-in")).toBeNull();
    expect(pendingConnectLinkToken(null)).toBeNull();
  });

  it("never visits a login page that is not an https address, and keeps no link", async () => {
    const world: World = { dead: false, loginPage: "javascript:alert(document.domain)//", completed: [] };
    render(<ConnectLinkView token={TOKEN} />, { wrapper: providers(world) });
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/The login page's address is not an https address/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CONNECT_LINK_PENDING_KEY)).toBeNull();
  });

  it("says a dead link has expired or was used, and offers nothing to click", async () => {
    render(<ConnectLinkView token={TOKEN} />, { wrapper: providers({ dead: true, completed: [] }) });
    expect(
      await screen.findByText("This link has expired or was already used: ask the app that sent it for a new one."),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("useConnectLink", () => {
  it("a start the server refuses for another reason says why and stays on the page", async () => {
    const { result } = renderHook(() => useConnectLink(TOKEN), {
      wrapper: providers({ dead: false, startRefused: true, completed: [] }),
    });
    await waitFor(() => expect(result.current.info).not.toBeNull());
    await act(() => result.current.start());
    expect(result.current.error?.message).toContain("nothing can sign in to https://mcp.slack.com/mcp");
    expect(result.current.isDead).toBe(false);
    expect(result.current.isStarting).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("with no link starts nothing", async () => {
    const { result } = renderHook(() => useConnectLink(null), { wrapper: providers({ dead: false, completed: [] }) });
    await act(() => result.current.start());
    expect(assign).not.toHaveBeenCalled();
    expect(result.current.isStarting).toBe(false);
  });

  it("a tab whose storage cannot be read has no pending link", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(pendingConnectLinkToken("st")).toBeNull();
  });
});

describe("ConnectLinkCallback", () => {
  it("completes once even when React runs its effect twice", async () => {
    const world: World = { dead: false, completed: [] };
    render(
      <StrictMode>
        <ConnectLinkCallback token={TOKEN} />
      </StrictMode>,
      { wrapper: providers(world) },
    );
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(world.completed).toHaveLength(1);
  });

  it("completes with the code and state, forgets the secret, and goes to the answered URL", async () => {
    keepPendingLink();
    const world: World = { dead: false, completed: [] };
    render(<ConnectLinkCallback token={TOKEN} />, { wrapper: providers(world) });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("https://helpdesk.example/done?stigmer_connect=connected"));
    expect(world.completed[0]).toMatchObject({ token: TOKEN, code: "c-1", state: "st", error: "" });
    expect(pendingConnectLinkToken("st")).toBeNull();
  });

  it("says a dead link has expired or was used", async () => {
    keepPendingLink();
    render(<ConnectLinkCallback token={TOKEN} />, { wrapper: providers({ dead: true, completed: [] }) });
    expect(
      await screen.findByText("This link has expired or was already used: ask the app that sent it for a new one."),
    ).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(pendingConnectLinkToken("st")).toBeNull();
  });

  it("keeps the link when the answer does not arrive, so a reload tries again", async () => {
    keepPendingLink();
    render(<ConnectLinkCallback token={TOKEN} />, {
      wrapper: providers({ dead: false, completeUnavailable: true, completed: [] }),
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(pendingConnectLinkToken("st")).toBe(TOKEN);
  });
});
