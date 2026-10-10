import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { StigmerContext } from "../../context";
import { DeploymentModeContext } from "../../deployment-mode";
import { useChannelToolReadiness } from "../useChannelToolReadiness";

function toolAgent(overrides?: { plugins?: boolean }): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: "acme", slug: "helper" },
    spec: {
      instructions: "help",
      plugins:
        (overrides?.plugins ?? true)
          ? [{ org: "acme", slug: "github" }]
          : [],
    },
  });
}

function mockStigmer(overrides: {
  envVisibility?: Record<string, ApiResourceVisibility>;
  envError?: boolean;
}) {
  return {
    vault: {
      getByReference: vi.fn().mockImplementation(
        ({ slug }: { org: string; slug: string }) => {
          if (overrides.envError) {
            return Promise.reject(new Error("not found"));
          }
          // An org-visible entry stands for a shared vault; anything else
          // for a person's My vault, which these surfaces refuse.
          const shared =
            (overrides.envVisibility?.[slug] ??
              ApiResourceVisibility.visibility_private) ===
            ApiResourceVisibility.visibility_org;
          return Promise.resolve({
            spec: { owner: { case: shared ? "org" : "person" } },
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
    client as { vault: { getByReference: ReturnType<typeof vi.fn> } }
  ).vault.getByReference;
}

describe("useChannelToolReadiness", () => {
  it("reports needs-credentials when a tool-using channel has no bindings — no lookups fire", async () => {
    const client = mockStigmer({});
    const { result } = renderHook(
      () => useChannelToolReadiness(toolAgent(), true, []),
      { wrapper: wrapper(client) },
    );

    // A tool-using agent with zero named vaults is broken over the
    // channel BY CONSTRUCTION (channel runs receive credentials
    // only from the channel's bindings) — the hook says so instead of
    // staying silent, and needs no server round-trip to know it.
    expect(result.current).toEqual({ status: "needs-credentials" });
    await waitFor(() => expect(envLookup(client)).not.toHaveBeenCalled());
  });

  it("reports blocked with the vaults that cannot serve listed", async () => {
    const client = mockStigmer({
      envVisibility: {
        "shared-creds": ApiResourceVisibility.visibility_org,
      },
    });

    const { result } = renderHook(
      () =>
        useChannelToolReadiness(toolAgent(), true, [
          { org: "acme", slug: "private-creds" },
          { org: "acme", slug: "shared-creds" },
        ]),
      { wrapper: wrapper(client) },
    );

    await waitFor(() =>
      expect(result.current).toEqual({
        status: "blocked",
        unusableVaults: ["acme/private-creds"],
      }),
    );
  });

  it("reports ready when every named vault is a shared vault", async () => {
    const client = mockStigmer({
      envVisibility: {
        "shared-creds": ApiResourceVisibility.visibility_org,
      },
    });

    const { result } = renderHook(
      () =>
        useChannelToolReadiness(toolAgent(), true, [
          { org: "acme", slug: "shared-creds" },
        ]),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current).toEqual({ status: "ready" }));
  });

  it("is n/a for agents that list no plugins — no lookups fire", async () => {
    const client = mockStigmer({});
    const { result } = renderHook(
      () =>
        useChannelToolReadiness(toolAgent({ plugins: false }), true, [
          { org: "acme", slug: "shared-creds" },
        ]),
      { wrapper: wrapper(client) },
    );

    expect(result.current).toEqual({ status: "na" });
    await waitFor(() => expect(envLookup(client)).not.toHaveBeenCalled());
  });

  it("is n/a when the channel is disabled — a paused channel serves no traffic", () => {
    const client = mockStigmer({});
    const { result } = renderHook(
      () => useChannelToolReadiness(toolAgent(), false, []),
      { wrapper: wrapper(client) },
    );

    expect(result.current).toEqual({ status: "na" });
  });

  it("is n/a in local mode — the channel runtime is cloud-only", () => {
    const client = mockStigmer({});
    const { result } = renderHook(
      () => useChannelToolReadiness(toolAgent(), true, []),
      { wrapper: wrapper(client, "local") },
    );

    expect(result.current).toEqual({ status: "na" });
  });
});
