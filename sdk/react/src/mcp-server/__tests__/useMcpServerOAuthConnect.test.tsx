/**
 * Pins the OAuth connect flow's phases: where a failure lands
 * (`failedPhase`), the honest copy for a discovery-leg failure, a sign-in
 * started at the server's address (its URL), never at its id, a local
 * program refused before any sign-in, and a sign-in saved into a shared
 * vault, which names the vault and its organization, chains no discovery
 * (the connect lane reads only My vault) and, when the person may not edit
 * the vault, says who can act.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import {
  CompleteSignInOutputSchema,
  StartSignInOutputSchema,
  type StartSignInInput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { getUserMessage } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import {
  useMcpServerOAuthConnect,
  getOAuthConnectErrorMessage,
} from "../useMcpServerOAuthConnect";

// The popup machinery is window-dependent (window.open, postMessage,
// BroadcastChannel); tests drive the RPC chain, so replace it with a
// deterministic callback handshake.
vi.mock("../../internal/oauthPopup.js", () => ({
  openOAuthPopup: vi.fn(() => ({ location: { href: "" }, closed: false })),
  popupBlockedError: vi.fn(
    () => new Error("Popup was blocked by the browser."),
  ),
  waitForOAuthCallback: vi.fn(async () => ({
    code: "auth-code",
    state: "state-1",
  })),
  closeOAuthPopup: vi.fn(),
  OAUTH_CALLBACK_MESSAGE_TYPE: "stigmer:oauth:callback",
  OAUTH_BROADCAST_CHANNEL: "stigmer:oauth:broadcast",
}));

afterEach(cleanup);

const SERVER_ID = "mcps_01test";
const ORG = "acme";

function renderOAuthHook(
  register: Parameters<typeof createRouterTransport>[0],
) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport(register),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return renderHook(() => useMcpServerOAuthConnect(), { wrapper });
}

const SERVER_URL = "https://MCP.vendor.example/mcp/";

/** The server the flow reads its address from. */
function serverQueries(url = SERVER_URL) {
  return {
    get: () =>
      create(McpServerSchema, {
        metadata: { id: SERVER_ID, name: "Linear" },
        spec: { serverType: { case: "http", value: { url } } },
      }),
  };
}

/** start + complete succeed — the failure point is chosen per test. */
function happySignIn() {
  return {
    startSignIn: () =>
      create(StartSignInOutputSchema, {
        authorizationUrl: "https://vendor.example/authorize",
        state: "state-1",
      }),
    completeSignIn: () =>
      create(CompleteSignInOutputSchema, { address: "https://mcp.vendor.example/mcp" }),
  };
}

describe("useMcpServerOAuthConnect — failedPhase", () => {
  it("records 'connecting' when only the chained discovery fails (sign-in succeeded)", async () => {
    const { result } = renderOAuthHook((router) => {
      router.service(McpServerQueryController, serverQueries());
      router.service(VaultCommandController, happySignIn());
      router.service(McpServerCommandController, {
        connect: () => {
          throw new ConnectError("discovery workflow failed", Code.Internal);
        },
      });
    });

    await act(async () => {
      await expect(
        result.current.startOAuth(SERVER_ID, ORG),
      ).rejects.toThrow();
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.failedPhase).toBe("connecting");
    expect(result.current.phase).toBe("idle");
  });

  it("records 'completing' when the token exchange itself fails", async () => {
    const { result } = renderOAuthHook((router) => {
      router.service(McpServerQueryController, serverQueries());
      router.service(VaultCommandController, {
        startSignIn: happySignIn().startSignIn,
        completeSignIn: () => {
          throw new ConnectError("token exchange failed", Code.Unavailable);
        },
      });
    });

    await act(async () => {
      await expect(
        result.current.startOAuth(SERVER_ID, ORG),
      ).rejects.toThrow();
    });

    expect(result.current.failedPhase).toBe("completing");
  });

  it("clears failedPhase on clearError and on a fresh startOAuth", async () => {
    let failConnect = true;
    const { result } = renderOAuthHook((router) => {
      router.service(McpServerQueryController, serverQueries());
      router.service(VaultCommandController, happySignIn());
      router.service(McpServerCommandController, {
        connect: () => {
          if (failConnect) {
            throw new ConnectError("discovery workflow failed", Code.Internal);
          }
          return {};
        },
      });
    });

    await act(async () => {
      await expect(
        result.current.startOAuth(SERVER_ID, ORG),
      ).rejects.toThrow();
    });
    expect(result.current.failedPhase).toBe("connecting");

    act(() => result.current.clearError());
    expect(result.current.failedPhase).toBeNull();
    expect(result.current.error).toBeNull();

    failConnect = false;
    await act(async () => {
      await result.current.startOAuth(SERVER_ID, ORG);
    });
    expect(result.current.failedPhase).toBeNull();
    expect(result.current.phase).toBe("done");
  });
});

describe("useMcpServerOAuthConnect — the address", () => {
  it("signs in at the server's URL, saved in My vault", async () => {
    const started: StartSignInInput[] = [];
    const { result } = renderOAuthHook((router) => {
      router.service(McpServerQueryController, serverQueries());
      router.service(VaultCommandController, {
        ...happySignIn(),
        startSignIn: (input) => {
          started.push(input);
          return happySignIn().startSignIn();
        },
      });
      router.service(McpServerCommandController, { connect: () => ({}) });
    });

    await act(async () => {
      await result.current.startOAuth(SERVER_ID, ORG);
    });
    expect(started[0]).toMatchObject({
      address: "https://mcp.vendor.example/mcp",
      vault: { org: ORG, vault: { case: "mine", value: true } },
    });
  });

  it("refuses a server with no address before any sign-in starts", async () => {
    let starts = 0;
    const { result } = renderOAuthHook((router) => {
      router.service(McpServerQueryController, serverQueries("https://${HOST}/mcp"));
      router.service(VaultCommandController, {
        startSignIn: () => {
          starts += 1;
          return happySignIn().startSignIn();
        },
      });
    });

    await act(async () => {
      await expect(result.current.startOAuth(SERVER_ID, ORG)).rejects.toThrow("no address to sign in at");
    });
    expect(starts).toBe(0);
    expect(result.current.failedPhase).toBe("initiating");
  });
});

describe("useMcpServerOAuthConnect — a sign-in saved into a shared vault", () => {
  const VAULT = { id: "vlt_team", org: "org_acme", name: "Team tools" };

  it("names the vault and its organization, and chains no discovery", async () => {
    const started: StartSignInInput[] = [];
    let connects = 0;
    const { result } = renderOAuthHook((router) => {
      router.service(VaultCommandController, {
        ...happySignIn(),
        startSignIn: (input) => {
          started.push(input);
          return happySignIn().startSignIn();
        },
      });
      router.service(McpServerCommandController, {
        connect: () => {
          connects += 1;
          return {};
        },
      });
      router.service(McpServerQueryController, serverQueries());
    });

    let server: Awaited<ReturnType<typeof result.current.startOAuth>> | undefined;
    await act(async () => {
      server = await result.current.startOAuth(SERVER_ID, ORG, { vault: VAULT });
    });
    expect(started[0]).toMatchObject({ vault: { org: "org_acme", vault: { case: "id", value: "vlt_team" } } });
    expect(connects).toBe(0);
    expect(server?.metadata?.name).toBe("Linear");
    expect(result.current.phase).toBe("done");
  });

  it("says who can act when the person may not edit the vault, and passes other refusals through", async () => {
    let code = Code.PermissionDenied;
    const { result } = renderOAuthHook((router) => {
      router.service(McpServerQueryController, serverQueries());
      router.service(VaultCommandController, {
        startSignIn: () => {
          throw new ConnectError("unauthorized to save a sign-in in this vault", code);
        },
      });
    });

    await act(async () => {
      await expect(result.current.startOAuth(SERVER_ID, ORG, { vault: VAULT })).rejects.toThrow();
    });
    expect(getUserMessage(result.current.error)).toBe(
      "This conversation uses only its vaults, so the sign-in must be saved in vault 'Team tools', which you may not edit. " +
        "Ask an admin of that vault to sign in there, or to let you edit it.",
    );

    code = Code.NotFound;
    await act(async () => {
      await expect(result.current.startOAuth(SERVER_ID, ORG, { vault: VAULT })).rejects.toThrow();
    });
    expect(getUserMessage(result.current.error)).toBe("unauthorized to save a sign-in in this vault");
  });
});

describe("getOAuthConnectErrorMessage", () => {
  it("leads with the sign-in-succeeded fact for discovery-leg failures", () => {
    const error = new ConnectError("workflow timed out", Code.Internal);
    expect(getOAuthConnectErrorMessage(error, "connecting")).toBe(
      "Signed in successfully, but tool discovery failed: workflow timed out",
    );
  });

  it("passes other phases through unprefixed", () => {
    const error = new ConnectError("token exchange failed", Code.Unavailable);
    expect(getOAuthConnectErrorMessage(error, "completing")).toBe(
      "token exchange failed",
    );
    expect(getOAuthConnectErrorMessage(error, null)).toBe(
      "token exchange failed",
    );
  });
});
