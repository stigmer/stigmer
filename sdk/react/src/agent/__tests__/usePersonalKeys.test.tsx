/**
 * The keys a run takes from the person's own credentials, by the
 * resolver's rule: each requirement (the agent's own keys, each MCP
 * server's) met by the person's credential serving its declarer. Pinned:
 * a key the organization's credential gives, or that nothing gives, is
 * not named; an MCP server's key is named when the person's credential
 * serving that server holds it, never from one serving the agent; not
 * ready while the servers or the credentials load; a server that cannot
 * be read is left out; a usage that names no server is skipped. Without
 * an organization list, an organization reference is taken as the id it
 * names.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { storedCredential } from "../../credential/__tests__/credential-world";
import { useOrganizationId, usePersonalKeys } from "../usePersonalKeys";

const ORG = "org_acme";
const AGENT = { kind: "agent", org: ORG, slug: "reviewer" } as const;
const CALENDAR = { kind: "mcp_server", org: ORG, slug: "calendar" } as const;

function wrapperFor(getServer: ReturnType<typeof vi.fn>, credentials: readonly Credential[] | "pending" = []) {
  const client = {
    mcpServer: { getByReference: getServer },
    credential: {
      list: credentials === "pending"
        ? vi.fn().mockReturnValue(new Promise(() => {}))
        : vi.fn().mockResolvedValue({ items: credentials, totalCount: credentials.length }),
    },
  } as unknown as Stigmer;
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function agentWith(env: readonly string[], servers: readonly string[] = ["calendar"]) {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: ORG, slug: "reviewer" },
    spec: {
      env: Object.fromEntries(env.map((key) => [key, {}])),
      mcpServerUsages: servers.map((slug) => ({ mcpServerRef: { org: ORG, slug } })),
    },
  });
}

const calendarServer = vi.fn().mockResolvedValue({
  metadata: { id: "mcp_calendar", org: ORG, slug: "calendar", name: "Calendar" },
  spec: { env: { CAL_TOKEN: {} } },
});

describe("usePersonalKeys", () => {
  it("is not ready while the agent's servers load", () => {
    const agent = agentWith(["GITHUB_TOKEN"]);
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(vi.fn().mockReturnValue(new Promise(() => {}))),
    });
    expect(result.current).toEqual({ keys: [], isReady: false });
  });

  it("is not ready while the credentials load", async () => {
    const agent = agentWith(["GITHUB_TOKEN"], []);
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(vi.fn(), "pending"),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toEqual({ keys: [], isReady: false });
  });

  it("names the keys the person's own credentials give, per declarer, sorted", async () => {
    const agent = agentWith(["GITHUB_TOKEN", "LINEAR_API_KEY", "TEAM_KEY"]);
    const credentials = [
      storedCredential({ id: "mine", org: ORG, owner: "person", fields: ["LINEAR_API_KEY", "GITHUB_TOKEN"], serves: [AGENT] }),
      storedCredential({ id: "mine-cal", org: ORG, owner: "person", fields: ["CAL_TOKEN"], serves: [CALENDAR] }),
      storedCredential({ id: "team", org: ORG, owner: "org", fields: ["TEAM_KEY"], serves: [AGENT] }),
    ];
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(calendarServer, credentials),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.keys).toEqual(["CAL_TOKEN", "GITHUB_TOKEN", "LINEAR_API_KEY"]);
  });

  it("never names a server's key from a credential serving the agent", async () => {
    const agent = agentWith([]);
    const credentials = [
      storedCredential({ id: "mine", org: ORG, owner: "person", fields: ["CAL_TOKEN"], serves: [AGENT] }),
    ];
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(calendarServer, credentials),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.keys).toEqual([]);
  });

  it("skips a server usage that names no server and leaves out a server that cannot be read", async () => {
    const agent = create(AgentSchema, {
      metadata: { id: "agt_1", org: ORG, slug: "reviewer" },
      spec: { env: { GITHUB_TOKEN: {} }, mcpServerUsages: [{}, { mcpServerRef: { org: ORG, slug: "calendar" } }] },
    });
    const getServer = vi.fn().mockRejectedValue(new Error("denied"));
    const credentials = [storedCredential({ id: "mine", org: ORG, owner: "person", fields: ["GITHUB_TOKEN"], serves: [AGENT] })];
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(getServer, credentials),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.keys).toEqual(["GITHUB_TOKEN"]);
    expect(getServer).toHaveBeenCalledTimes(1);
  });

  it("takes an organization reference as the id it names when no organization list is mounted", () => {
    const { result } = renderHook(() => useOrganizationId("org_acme"), {
      wrapper: wrapperFor(vi.fn()),
    });
    expect(result.current).toBe("org_acme");
  });
});
