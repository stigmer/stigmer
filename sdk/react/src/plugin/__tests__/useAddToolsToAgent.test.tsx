/**
 * Adding a plugin's servers to an agent, against an in-memory Connect
 * backend. Pins: the pick is fetched and an agent a plugin installed is
 * refused before any update, in the `managed` phase, from its
 * `stigmer.ai/plugin` label; a plain agent is updated with the servers it
 * did not already list appended after the ones it had, and the count of
 * what was added is what the dialog says; a refused update returns the
 * flow to `ready` with the error held.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { type Agent, AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema, McpServerUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { StigmerContext } from "../../context.js";
import { useAddToolsToAgent } from "../useAddToolsToAgent.js";

afterEach(cleanup);

const ORG = "acme";
const SERVERS = [
  { ref: { org: ORG, slug: "linear" }, name: "Linear" },
  { ref: { org: ORG, slug: "notion" }, name: "Notion" },
];

function agent(slug: string, labels: Record<string, string>, listed: readonly string[]): Agent {
  return create(AgentSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `agt_${slug}`, org: ORG, slug, name: slug, labels }),
    spec: create(AgentSpecSchema, {
      instructions: "help",
      mcpServerUsages: listed.map((s) => create(McpServerUsageSchema, { mcpServerRef: create(ApiResourceReferenceSchema, { org: ORG, slug: s }) })),
    }),
  });
}

function setup(agents: Record<string, Agent>, refuseUpdate = false) {
  const updates: Agent[] = [];
  const transport = createRouterTransport(({ service }) => {
    service(AgentQueryController, {
      getByReference: (ref) => {
        const found = agents[ref.slug];
        if (!found) throw new ConnectError("no agent", Code.NotFound);
        return found;
      },
    });
    service(AgentCommandController, {
      update: (req) => {
        if (refuseUpdate) throw new ConnectError("agent 'reviewer' is managed by plugin 'toolbox'", Code.FailedPrecondition);
        updates.push(req);
        return req;
      },
    });
  });
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport });
  const wrapper = ({ children }: { children: ReactNode }) => <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  const hook = renderHook(() => useAddToolsToAgent(SERVERS), { wrapper });
  return { hook, updates };
}

describe("useAddToolsToAgent", () => {
  it("refuses an agent a plugin installed before any update, from its label", async () => {
    const { hook, updates } = setup({ assistant: agent("assistant", { "stigmer.ai/plugin": "plg_1" }, []) });
    act(() => hook.result.current.pick({ org: ORG, slug: "assistant" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("managed"));
    expect(await hook.result.current.add()).toBe(0);
    expect(updates).toEqual([]);
  });

  it("appends the servers the agent does not list, after the ones it has, and counts them", async () => {
    const { hook, updates } = setup({ reviewer: agent("reviewer", {}, ["notion"]) });
    act(() => hook.result.current.pick({ org: ORG, slug: "reviewer" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("ready"));
    expect(hook.result.current.phase).toMatchObject({ alreadyListed: ["Notion"] });

    let added = 0;
    await act(async () => {
      added = await hook.result.current.add();
    });
    expect(added).toBe(1);
    expect(hook.result.current.phase).toMatchObject({ status: "added", addedCount: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.spec?.mcpServerUsages.map((u) => u.mcpServerRef?.slug)).toEqual(["notion", "linear"]);
    expect(updates[0]?.spec?.instructions).toBe("help");
  });

  it("holds a refused update as the error and returns to ready", async () => {
    const { hook } = setup({ reviewer: agent("reviewer", {}, []) }, true);
    act(() => hook.result.current.pick({ org: ORG, slug: "reviewer" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("ready"));
    await act(async () => {
      await expect(hook.result.current.add()).rejects.toThrow(/managed by plugin/);
    });
    expect(hook.result.current.phase.status).toBe("ready");
    expect(hook.result.current.error?.message).toMatch(/managed by plugin/);
  });
});
