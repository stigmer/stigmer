/**
 * The keys a run reads from the person's My vault, as the server fills
 * them: the agent's own keys, the keys its own MCP servers read, and the
 * keys its plugins' servers and hooks read, minus the login key of every
 * server that signs in (a sign-in fills it) and every key the runner fills
 * itself, and none for an agent of another organization. Not ready while
 * the plugins load; a plugin that cannot be read leaves the other keys
 * named. Without an organization list, an organization reference is taken
 * as the id it names; with one, a reference to the organization the person
 * has open outside their list (a child its parent's admin opened) names its
 * id too, so that organization's agents read their keys.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { OrgProvider, useOrg } from "../../organization/OrgProvider";
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

  it("names the keys the agent's own servers read, but no value the runner fills", async () => {
    const agent = create(AgentSchema, {
      metadata: { id: "agt_1", org: ORG, slug: "support" },
      spec: {
        mcpServers: [
          {
            name: "zendesk",
            url: "https://acme-co.zendesk.com/mcp",
            headers: { "X-Api-Key": "${ZENDESK_KEY}", "X-Caller": "${STIGMER_CALLER_IDENTITY_VALUE}" },
          },
        ],
      },
    });
    const getPlugin = vi.fn();
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(getPlugin),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.keys).toEqual(["ZENDESK_KEY"]);
    expect(getPlugin).not.toHaveBeenCalled();
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

describe("usePersonalKeys in an organization opened outside the person's list", () => {
  const CHILD_ID = "org_01jccccccccccccccccccccccc";
  const child = { metadata: { id: CHILD_ID, slug: "acme-customer" }, spec: { parentOrg: ORG } } as Organization;

  function wrapperInOpenedChild() {
    localStorage.setItem("stigmer:activeOrg", CHILD_ID);
    const client = {
      plugin: { getByReference: vi.fn() },
      organization: {
        listMine: vi.fn(async () => ({ entries: [{ metadata: { id: ORG, slug: "acme" } }], nextPageToken: "" })),
        get: vi.fn(async () => child),
      },
    } as unknown as Stigmer;
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <FetchCacheContext.Provider value={null}>
          <StigmerContext.Provider value={client}>
            <OrgProvider>{children}</OrgProvider>
          </StigmerContext.Provider>
        </FetchCacheContext.Provider>
      );
    };
  }

  it("names the open child's id for its slug, so its agent's keys are read", async () => {
    const agent = create(AgentSchema, {
      metadata: { id: "agt_2", org: CHILD_ID, slug: "support" },
      spec: { env: { SUPPORT_TOKEN: {} } },
    });
    const { result } = renderHook(
      () => ({
        activeId: useOrg().activeOrg?.metadata?.id,
        id: useOrganizationId("acme-customer"),
        keys: usePersonalKeys(agent, agent.spec, "acme-customer"),
      }),
      { wrapper: wrapperInOpenedChild() },
    );
    await waitFor(() => expect(result.current.activeId).toBe(CHILD_ID));
    expect(result.current.id).toBe(CHILD_ID);
    await waitFor(() => expect(result.current.keys).toEqual({ keys: ["SUPPORT_TOKEN"], isReady: true }));
    localStorage.clear();
  });
});
