/**
 * useMcpServerReadiness's sign-in, with the server read, its grant read and
 * the OAuth flow stubbed so the hook's own wiring is what is pinned: a
 * sign-in that lands refetches the server and its grant and hands the
 * server's id to `onSignedIn`; one that fails calls neither. The rows that
 * render the hook against a backend are pinned in
 * `PluginDetailView.readiness.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { McpServerAuthSchema, McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { useMcpServerReadiness } from "../useMcpServerReadiness";

const SERVER = create(McpServerSchema, {
  metadata: { id: "mcp_linear", org: "acme", slug: "linear", name: "Linear" },
  spec: create(McpServerSpecSchema, {
    auth: create(McpServerAuthSchema, { targetEnvVar: "LINEAR_ACCESS_TOKEN", oauthOnly: true }),
  }),
});

const refetchServer = vi.fn();
const refetchGrant = vi.fn();
const startOAuth = vi.fn<(mcpServerId: string, org: string) => Promise<unknown>>();

vi.mock("../../mcp-server/useMcpServer.js", () => ({
  useMcpServer: () => ({ mcpServer: SERVER, isLoading: false, error: null, refetch: refetchServer }),
}));

vi.mock("../../mcp-server/useMcpServerCredentials.js", () => ({
  useMcpServerCredentials: () => ({
    authMode: "oauth",
    isOAuthConnected: false,
    connectionHealth: OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
    isVendorApprovalBlocked: false,
    refetch: refetchGrant,
  }),
}));

vi.mock("../../mcp-server/useMcpServerOAuthConnect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../mcp-server/useMcpServerOAuthConnect.js")>();
  return {
    ...actual,
    useMcpServerOAuthConnect: () => ({
      startOAuth,
      clearError: () => undefined,
      error: null,
      failedPhase: null,
      phase: "idle",
      isInProgress: false,
    }),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useMcpServerReadiness — sign-in", () => {
  it("refetches and hands the server's id to onSignedIn when the sign-in lands", async () => {
    const signedIn = Promise.resolve(SERVER);
    startOAuth.mockReturnValue(signedIn);
    const onSignedIn = vi.fn<(mcpServerId: string) => void>();
    const { result } = renderHook(() => useMcpServerReadiness("acme", "linear", onSignedIn));
    expect(result.current.kind).toBe("sign-in-needed");

    await act(async () => {
      result.current.signIn();
      await signedIn;
    });

    expect(startOAuth).toHaveBeenCalledWith("mcp_linear", "acme");
    expect(refetchServer).toHaveBeenCalledTimes(1);
    expect(refetchGrant).toHaveBeenCalledTimes(1);
    expect(onSignedIn).toHaveBeenCalledWith("mcp_linear");
  });

  it("calls neither the refetch nor onSignedIn when the sign-in fails", async () => {
    const failed = Promise.reject(new Error("popup closed"));
    startOAuth.mockReturnValue(failed);
    const onSignedIn = vi.fn<(mcpServerId: string) => void>();
    const { result } = renderHook(() => useMcpServerReadiness("acme", "linear", onSignedIn));

    await act(async () => {
      result.current.signIn();
      await failed.catch(() => undefined);
    });

    expect(startOAuth).toHaveBeenCalledTimes(1);
    expect(refetchServer).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
