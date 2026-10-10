/**
 * Adding a plugin to an agent, against an in-memory Connect backend. Pins:
 * the pick is fetched and an agent a plugin installed is refused before any
 * update, in the `managed` phase, from its `stigmer.ai/plugin` label; a
 * plain agent is updated with the plugin appended to its `plugins` after
 * the ones it had, every other field kept; an agent that lists the plugin
 * already is not updated and says so; an agent whose tool list leaves the
 * plugin's servers out is told so before the add (`toolsLeaveOut`), and one
 * whose list names a server, or `mcp__*`, is not; a refused update returns
 * the flow to `ready` with the error held. A cleared pick and a failed read
 * return to picking, the read's error held until cleared or reset.
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
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context.js";
import { type PluginOffer, toolsLeaveOut, useAddPluginToAgent } from "../useAddPluginToAgent.js";

afterEach(cleanup);

const ORG = "acme";
const OFFER: PluginOffer = { plugin: { org: ORG, slug: "linear" }, name: "linear", servers: ["linear"] };

function agent(
  slug: string,
  labels: Record<string, string>,
  plugins: readonly string[],
  extra: { readonly tools?: readonly string[] } = {},
): Agent {
  return create(AgentSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `agt_${slug}`, org: ORG, slug, name: slug, labels }),
    spec: create(AgentSpecSchema, {
      instructions: "help",
      plugins: plugins.map((plugin) => ({ org: ORG, slug: plugin })),
      tools: [...(extra.tools ?? [])],
      env: { API_TOKEN: create(EnvVarDeclarationSchema, { description: "already here" }) },
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
  const hook = renderHook(() => useAddPluginToAgent(OFFER), { wrapper });
  return { hook, updates };
}

describe("useAddPluginToAgent", () => {
  it("refuses an agent a plugin installed before any update, from its label", async () => {
    const { hook, updates } = setup({ assistant: agent("assistant", { "stigmer.ai/plugin": "plg_1" }, []) });
    act(() => hook.result.current.pick({ org: ORG, slug: "assistant" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("managed"));
    expect(await hook.result.current.add()).toEqual({ added: false });
    expect(updates).toEqual([]);
  });

  it("appends the plugin after the ones the agent lists, keeping the rest of its spec", async () => {
    const { hook, updates } = setup({ reviewer: agent("reviewer", {}, ["notion"]) });
    act(() => hook.result.current.pick({ org: ORG, slug: "reviewer" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("ready"));
    expect(hook.result.current.phase).toMatchObject({ alreadyListed: false, toolsLeaveOut: false });

    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.add();
    });
    expect(outcome).toEqual({ added: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.spec?.plugins.map((ref) => ref.slug)).toEqual(["notion", "linear"]);
    expect(updates[0]!.spec?.env["API_TOKEN"]?.description).toBe("already here");
    expect(hook.result.current.phase.status).toBe("added");
  });

  it("saves nothing for an agent that already lists the plugin", async () => {
    const { hook, updates } = setup({ reviewer: agent("reviewer", {}, ["linear"]) });
    act(() => hook.result.current.pick({ org: ORG, slug: "reviewer" }));
    await waitFor(() => expect(hook.result.current.phase).toMatchObject({ status: "ready", alreadyListed: true }));
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.add();
    });
    expect(outcome).toEqual({ added: false });
    expect(updates).toEqual([]);
    expect(hook.result.current.phase).toMatchObject({ status: "added", outcome: { added: false } });
  });

  it("says when the agent's tool list leaves the plugin's servers out", async () => {
    const { hook } = setup({ reviewer: agent("reviewer", {}, [], { tools: ["Read", "mcp__github__*"] }) });
    act(() => hook.result.current.pick({ org: ORG, slug: "reviewer" }));
    await waitFor(() => expect(hook.result.current.phase).toMatchObject({ status: "ready", toolsLeaveOut: true }));
  });

  it("holds a refused update's error and returns to ready", async () => {
    const { hook } = setup({ reviewer: agent("reviewer", {}, []) }, true);
    act(() => hook.result.current.pick({ org: ORG, slug: "reviewer" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("ready"));
    await act(async () => {
      await expect(hook.result.current.add()).rejects.toThrow(/managed by plugin 'toolbox'/);
    });
    expect(hook.result.current.phase.status).toBe("ready");
    expect(hook.result.current.error?.message).toMatch(/managed by plugin 'toolbox'/);
  });

  it("returns to picking on a cleared pick, and on a failed read with its error held until reset", async () => {
    const { hook } = setup({});
    act(() => hook.result.current.pick({ org: ORG, slug: "ghost" }));
    await waitFor(() => expect(hook.result.current.error?.message).toMatch(/no agent/));
    expect(hook.result.current.phase.status).toBe("picking");
    act(() => hook.result.current.reset());
    expect(hook.result.current.error).toBeNull();
    act(() => hook.result.current.pick(null));
    expect(hook.result.current.phase.status).toBe("picking");
  });
});

describe("toolsLeaveOut", () => {
  const input = (tools: string[]) => ({ name: "reviewer", org: ORG, tools });

  it("is false for an agent that names no tools: every tool is its", () => {
    expect(toolsLeaveOut(input([]), "linear", ["linear"])).toBe(false);
  });

  it("is false when the list names the server, one of its tools, or every MCP tool", () => {
    expect(toolsLeaveOut(input(["mcp__plugin_linear_linear"]), "linear", ["linear"])).toBe(false);
    expect(toolsLeaveOut(input(["mcp__plugin_linear_linear__create_issue"]), "linear", ["linear"])).toBe(false);
    expect(toolsLeaveOut(input(["mcp__*"]), "linear", ["linear"])).toBe(false);
  });

  it("is true when the list names none of the servers, a lookalike prefix included", () => {
    expect(toolsLeaveOut(input(["Read"]), "linear", ["linear"])).toBe(true);
    expect(toolsLeaveOut(input(["mcp__plugin_linear_linearx__*"]), "linear", ["linear"])).toBe(true);
  });

  it("is false for a plugin with no servers", () => {
    expect(toolsLeaveOut(input(["Read"]), "guard", [])).toBe(false);
  });
});
