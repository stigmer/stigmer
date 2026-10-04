import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useOrganizationId, usePersonalKeys } from "../usePersonalKeys";

// ---------------------------------------------------------------------------
// The keys a run reads from the person's personal environment, as the
// server fills them: the declared keys minus the agent's servers' OAuth
// variables, none for an agent of another organization. Not ready while
// the servers load; a server that cannot be read leaves its variables
// named. Without an organization list, an organization reference is taken
// as the id it names.
// ---------------------------------------------------------------------------

const ORG = "org_acme";

function wrapperFor(getServer: ReturnType<typeof vi.fn>) {
  const client = { mcpServer: { getByReference: getServer } } as unknown as Stigmer;
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
      env: { GITHUB_TOKEN: {}, CAL_TOKEN: {} },
      mcpServerUsages: [{ mcpServerRef: { org: ORG, slug: "calendar" } }],
    },
  });
}

describe("usePersonalKeys", () => {
  it("is not ready while the agent's servers load", () => {
    const agent = agentIn(ORG);
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(vi.fn().mockReturnValue(new Promise(() => {}))),
    });
    expect(result.current).toEqual({ keys: [], isReady: false });
  });

  it("names a variable of a server that cannot be read", async () => {
    const agent = agentIn(ORG);
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(vi.fn().mockRejectedValue(new Error("denied"))),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.keys).toEqual(["CAL_TOKEN", "GITHUB_TOKEN"]);
  });

  it("is ready with no keys, reading no server, for an agent of another organization", () => {
    const agent = agentIn("org_globex");
    const getServer = vi.fn();
    const { result } = renderHook(() => usePersonalKeys(agent, agent.spec, ORG), {
      wrapper: wrapperFor(getServer),
    });
    expect(result.current).toEqual({ keys: [], isReady: true });
    expect(getServer).not.toHaveBeenCalled();
  });

  it("takes an organization reference as the id it names when no organization list is mounted", () => {
    const { result } = renderHook(() => useOrganizationId("org_acme"), {
      wrapper: wrapperFor(vi.fn()),
    });
    expect(result.current).toBe("org_acme");
  });
});
