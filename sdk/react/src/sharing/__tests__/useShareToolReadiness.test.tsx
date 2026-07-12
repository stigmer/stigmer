import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { useShareToolReadiness } from "../useShareToolReadiness";

function toolAgent(overrides?: {
  mcpUsages?: boolean;
  defaultInstanceId?: string;
}): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: "acme", slug: "helper" },
    spec: {
      instructions: "help",
      mcpServerUsages:
        (overrides?.mcpUsages ?? true)
          ? [{ mcpServerRef: { org: "acme", slug: "github" } }]
          : [],
    },
    status: {
      defaultInstanceId: overrides?.defaultInstanceId ?? "agi_1",
    },
  });
}

function mockStigmer(overrides: {
  instanceEnvRefs?: { org: string; slug: string }[];
  envVisibility?: Record<string, ApiResourceVisibility>;
  envError?: boolean;
}) {
  return {
    agentInstance: {
      get: vi.fn().mockResolvedValue({
        spec: { environmentRefs: overrides.instanceEnvRefs ?? [] },
      }),
    },
    environment: {
      getByReference: vi.fn().mockImplementation(
        ({ slug }: { org: string; slug: string }) => {
          if (overrides.envError) {
            return Promise.reject(new Error("not found"));
          }
          return Promise.resolve({
            metadata: {
              visibility:
                overrides.envVisibility?.[slug] ??
                ApiResourceVisibility.visibility_private,
            },
          });
        },
      ),
    },
  } as never;
}

function wrapper(client: unknown, mode: "cloud" | "local" = "cloud") {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        <DeploymentModeContext.Provider value={mode}>
          {children}
        </DeploymentModeContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

describe("useShareToolReadiness", () => {
  it("reports blocked with the private environment refs listed", async () => {
    const client = mockStigmer({
      instanceEnvRefs: [
        { org: "acme", slug: "private-creds" },
        { org: "acme", slug: "shared-creds" },
      ],
      envVisibility: {
        "shared-creds": ApiResourceVisibility.visibility_org,
      },
    });

    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent(), true),
      { wrapper: wrapper(client) },
    );

    await waitFor(() =>
      expect(result.current).toEqual({
        status: "blocked",
        privateEnvironments: ["acme/private-creds"],
      }),
    );
  });

  it("reports ready when every bound environment is org-shared", async () => {
    const client = mockStigmer({
      instanceEnvRefs: [{ org: "acme", slug: "shared-creds" }],
      envVisibility: {
        "shared-creds": ApiResourceVisibility.visibility_org,
      },
    });

    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent(), true),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current).toEqual({ status: "ready" }));
  });

  it("treats an unreadable environment ref as blocking", async () => {
    const client = mockStigmer({
      instanceEnvRefs: [{ org: "acme", slug: "deleted-env" }],
      envError: true,
    });

    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent(), true),
      { wrapper: wrapper(client) },
    );

    await waitFor(() =>
      expect(result.current).toEqual({
        status: "blocked",
        privateEnvironments: ["acme/deleted-env"],
      }),
    );
  });

  it("is n/a for agents without MCP tools — no lookups fire", async () => {
    const client = mockStigmer({});
    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent({ mcpUsages: false }), true),
      { wrapper: wrapper(client) },
    );

    expect(result.current).toEqual({ status: "na" });
    await waitFor(() => {
      expect(
        (client as { agentInstance: { get: ReturnType<typeof vi.fn> } })
          .agentInstance.get,
      ).not.toHaveBeenCalled();
    });
  });

  it("is n/a when sharing is disabled", () => {
    const client = mockStigmer({
      instanceEnvRefs: [{ org: "acme", slug: "private-creds" }],
    });
    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent(), false),
      { wrapper: wrapper(client) },
    );

    expect(result.current).toEqual({ status: "na" });
  });

  it("is n/a in local mode — no guest runtime, no secret gating", () => {
    const client = mockStigmer({
      instanceEnvRefs: [{ org: "acme", slug: "private-creds" }],
    });
    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent(), true),
      { wrapper: wrapper(client, "local") },
    );

    expect(result.current).toEqual({ status: "na" });
  });

  it("is n/a when the instance has no bound environments (no warning on a guess)", async () => {
    const client = mockStigmer({ instanceEnvRefs: [] });
    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent(), true),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current).toEqual({ status: "na" }));
  });
});
