import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import {
  InitiateOAuthConnectOutputSchema,
  CompleteOAuthConnectOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
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

/** initiate + complete succeed — the failure point is chosen per test. */
function happyOAuthLegs() {
  return {
    initiateOAuthConnect: () =>
      create(InitiateOAuthConnectOutputSchema, {
        authorizationUrl: "https://vendor.example/authorize",
        state: "state-1",
      }),
    completeOAuthConnect: () =>
      create(CompleteOAuthConnectOutputSchema, { connected: true }),
  };
}

describe("useMcpServerOAuthConnect — failedPhase", () => {
  it("records 'connecting' when only the chained discovery fails (sign-in succeeded)", async () => {
    const { result } = renderOAuthHook((router) => {
      router.service(McpServerCommandController, {
        ...happyOAuthLegs(),
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
      router.service(McpServerCommandController, {
        initiateOAuthConnect: happyOAuthLegs().initiateOAuthConnect,
        completeOAuthConnect: () => {
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
      router.service(McpServerCommandController, {
        ...happyOAuthLegs(),
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
