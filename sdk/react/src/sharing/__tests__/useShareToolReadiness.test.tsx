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
import type { AgentShareDraft, SharingAudience } from "../useSaveAgentShare";

function toolAgent(overrides?: { mcpUsages?: boolean }): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: "acme", slug: "helper" },
    spec: {
      instructions: "help",
      mcpServerUsages:
        (overrides?.mcpUsages ?? true)
          ? [{ mcpServerRef: { org: "acme", slug: "github" } }]
          : [],
    },
  });
}

function makeDraft(overrides?: {
  enabled?: boolean;
  audience?: SharingAudience;
  environmentRefs?: { org: string; slug: string }[];
}): AgentShareDraft {
  return {
    enabled: overrides?.enabled ?? true,
    audience: overrides?.audience ?? "public",
    allowedOrigins: [],
    messages: { rateLimited: "", unavailable: "", conversationEnded: "" },
    environmentRefs: overrides?.environmentRefs ?? [],
    runConfig: undefined,
  };
}

function mockStigmer(overrides: {
  envVisibility?: Record<string, ApiResourceVisibility>;
  envError?: boolean;
}) {
  return {
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

function envLookup(client: unknown) {
  return (
    client as { environment: { getByReference: ReturnType<typeof vi.fn> } }
  ).environment.getByReference;
}

describe("useShareToolReadiness", () => {
  it("reports needs-credentials when a tool-using share has no bindings — no lookups fire", async () => {
    const client = mockStigmer({});
    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent(), makeDraft()),
      { wrapper: wrapper(client) },
    );

    // A tool-using agent with zero bound environments is broken for
    // visitors BY CONSTRUCTION (guests receive credentials only from the
    // share's bindings) — the hook says so instead of staying silent,
    // and needs no server round-trip to know it.
    expect(result.current).toEqual({ status: "needs-credentials" });
    await waitFor(() => expect(envLookup(client)).not.toHaveBeenCalled());
  });

  it("reports blocked with the private environment refs listed", async () => {
    const client = mockStigmer({
      envVisibility: {
        "shared-creds": ApiResourceVisibility.visibility_org,
      },
    });

    const { result } = renderHook(
      () =>
        useShareToolReadiness(
          toolAgent(),
          makeDraft({
            environmentRefs: [
              { org: "acme", slug: "private-creds" },
              { org: "acme", slug: "shared-creds" },
            ],
          }),
        ),
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
      envVisibility: {
        "shared-creds": ApiResourceVisibility.visibility_org,
      },
    });

    const { result } = renderHook(
      () =>
        useShareToolReadiness(
          toolAgent(),
          makeDraft({
            environmentRefs: [{ org: "acme", slug: "shared-creds" }],
          }),
        ),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current).toEqual({ status: "ready" }));
  });

  it("treats an unreadable environment ref as blocking", async () => {
    const client = mockStigmer({ envError: true });

    const { result } = renderHook(
      () =>
        useShareToolReadiness(
          toolAgent(),
          makeDraft({
            environmentRefs: [{ org: "acme", slug: "deleted-env" }],
          }),
        ),
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
      () =>
        useShareToolReadiness(
          toolAgent({ mcpUsages: false }),
          makeDraft({
            environmentRefs: [{ org: "acme", slug: "shared-creds" }],
          }),
        ),
      { wrapper: wrapper(client) },
    );

    expect(result.current).toEqual({ status: "na" });
    await waitFor(() => expect(envLookup(client)).not.toHaveBeenCalled());
  });

  it("is n/a when sharing is disabled", () => {
    const client = mockStigmer({});
    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent(), makeDraft({ enabled: false })),
      { wrapper: wrapper(client) },
    );

    expect(result.current).toEqual({ status: "na" });
  });

  it("is n/a for org-audience shares — bindings are public-audience only", () => {
    const client = mockStigmer({});
    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent(), makeDraft({ audience: "org" })),
      { wrapper: wrapper(client) },
    );

    // Org-audience shares reject environment_refs at the proto boundary
    // (member sessions carry no share linkage in Phase A), so there is
    // no credential state to advise on.
    expect(result.current).toEqual({ status: "na" });
  });

  it("is n/a in local mode — no guest runtime, no secret gating", () => {
    const client = mockStigmer({});
    const { result } = renderHook(
      () => useShareToolReadiness(toolAgent(), makeDraft()),
      { wrapper: wrapper(client, "local") },
    );

    expect(result.current).toEqual({ status: "na" });
  });
});
