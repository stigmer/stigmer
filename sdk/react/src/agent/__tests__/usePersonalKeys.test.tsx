/**
 * The keys a run reads from the person's My vault, as the server fills
 * them: the agent's own keys and the keys its plugins' servers and hooks
 * read, minus the login key of every server that signs in (a sign-in fills
 * it), and none for an agent of another organization. Not ready while the
 * plugins load; a plugin that cannot be read leaves only the agent's own
 * keys named. Without an organization list, an organization reference is
 * taken as the id it names.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useOrganizationId, usePersonalKeys } from "../usePersonalKeys";

const ORG = "org_acme";

function wrapperFor(getPlugin: ReturnType<typeof vi.fn>) {
  const client = { plugin: { getByReference: getPlugin } } as unknown as Stigmer;
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function agentIn(org: string) {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org, slug: "reviewer" },
    spec: {
      env: { GITHUB_TOKEN: {} },
      plugins: [{ org: ORG, slug: "calendar" }],
    },
  });
}

/** A plugin with a server that signs in (its login key CAL_TOKEN) and one that reads CAL_REGION. */
const calendar = create(PluginSchema, {
  metadata: { name: "calendar", org: ORG, slug: "calendar" },
  status: {
    mcpServers: [
      {
        name: "events",
        transport: { case: "http", value: { url: "https://cal.example.com/mcp", headers: { Authorization: "Bearer ${CAL_TOKEN}" } } },
        env: ["CAL_TOKEN"],
        signIn: {},
      },
      { name: "rooms", transport: { case: "stdio", value: { command: "rooms" } }, env: ["CAL_REGION"] },
    ],
    env: { CAL_TOKEN: { isSecret: true }, CAL_REGION: { isSecret: false } },
  },
});

describe("usePersonalKeys", () => {
  it("is not ready while the agent's plugins load", () => {
    const agent = agentIn(ORG);
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(vi.fn().mockReturnValue(new Promise(() => {}))),
    });
    expect(result.current).toEqual({ keys: [], isReady: false });
  });

  it("names the agent's keys and its plugins' keys, but not a sign-in's login key", async () => {
    const agent = agentIn(ORG);
    const getPlugin = vi.fn().mockResolvedValue(calendar);
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(getPlugin),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.keys).toEqual(["CAL_REGION", "GITHUB_TOKEN"]);
    expect(getPlugin).toHaveBeenCalledWith({ org: ORG, slug: "calendar" });
  });

  it("names only the agent's own keys when a plugin cannot be read", async () => {
    const agent = agentIn(ORG);
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(vi.fn().mockRejectedValue(new Error("denied"))),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.keys).toEqual(["GITHUB_TOKEN"]);
  });

  it("is ready with no keys, reading no plugin, for an agent of another organization", () => {
    const agent = agentIn("org_globex");
    const getPlugin = vi.fn();
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(getPlugin),
    });
    expect(result.current).toEqual({ keys: [], isReady: true });
    expect(getPlugin).not.toHaveBeenCalled();
  });

  it("takes an organization reference as the id it names when no organization list is mounted", () => {
    const { result } = renderHook(() => useOrganizationId("org_acme"), {
      wrapper: wrapperFor(vi.fn()),
    });
    expect(result.current).toBe("org_acme");
  });
});
