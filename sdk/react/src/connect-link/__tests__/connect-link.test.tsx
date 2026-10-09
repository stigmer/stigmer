/**
 * The Connect link's page and its callback, against an in-process server:
 * - the page says what the link is for and, on Continue, keeps the link's
 *   secret for the callback page and sends the browser to the login page;
 * - a link the server no longer knows (unknown, expired or used) says so,
 *   and offers nothing to click;
 * - the callback page hands the login page's code, state or error to the
 *   server with the link's secret, forgets the secret, and sends the
 *   browser to the URL the server answers; a dead link says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
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
import { CONNECT_LINK_TOKEN_KEY, pendingConnectLinkToken } from "../useConnectLink";

const TOKEN = "tok-123";

interface World {
  readonly dead: boolean;
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
        startConnectLink: () =>
          create(StartConnectLinkOutputSchema, { authorizationUrl: "https://slack.com/oauth/authorize?x=1", state: "st" }),
        completeConnectLink: (input) => {
          world.completed.push(input);
          if (world.dead) throw new ConnectError("Connect link not found", Code.NotFound);
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
    expect(sessionStorage.getItem(CONNECT_LINK_TOKEN_KEY)).toBe(TOKEN);
    expect(pendingConnectLinkToken()).toBe(TOKEN);
  });

  it("says a dead link has expired or was used, and offers nothing to click", async () => {
    render(<ConnectLinkView token={TOKEN} />, { wrapper: providers({ dead: true, completed: [] }) });
    expect(
      await screen.findByText("This link has expired or was already used: ask the app that sent it for a new one."),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ConnectLinkCallback", () => {
  it("completes with the code and state, forgets the secret, and goes to the answered URL", async () => {
    sessionStorage.setItem(CONNECT_LINK_TOKEN_KEY, TOKEN);
    const world: World = { dead: false, completed: [] };
    render(<ConnectLinkCallback token={TOKEN} />, { wrapper: providers(world) });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("https://helpdesk.example/done?stigmer_connect=connected"));
    expect(world.completed[0]).toMatchObject({ token: TOKEN, code: "c-1", state: "st", error: "" });
    expect(pendingConnectLinkToken()).toBeNull();
  });

  it("says a dead link has expired or was used", async () => {
    sessionStorage.setItem(CONNECT_LINK_TOKEN_KEY, TOKEN);
    render(<ConnectLinkCallback token={TOKEN} />, { wrapper: providers({ dead: true, completed: [] }) });
    expect(
      await screen.findByText("This link has expired or was already used: ask the app that sent it for a new one."),
    ).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(pendingConnectLinkToken()).toBeNull();
  });
});
