/**
 * Adding a plugin to an agent, against an in-memory Connect backend. Pins:
 * the pick is fetched and an agent a plugin installed is refused before any
 * update, in the `managed` phase, from its `stigmer.ai/plugin` label; a
 * plain agent is updated with the servers it did not already list appended
 * after the ones it had, and the count of what was added is what the dialog
 * says; a refused update returns the flow to `ready` with the error held.
 * With a hooks offer: the plugin is appended to the agent's hooks after the
 * sources it had, and each variable the hooks read that the agent does not
 * declare is declared as a required secret, named before the save; an agent
 * that already names the plugin keeps one source; a managed agent is
 * refused the same way. A cleared pick and a failed read return to picking,
 * the read's error held until cleared or reset.
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
import { AgentSpecSchema, HookSourceSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { HookConfigSchema, HookFormat, HookGroupSchema, HookHandlerSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { McpServerUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { StigmerContext } from "../../context.js";
import { type PluginOffer, useAddPluginToAgent } from "../useAddPluginToAgent.js";

afterEach(cleanup);

const ORG = "acme";
const SERVERS = [
  { ref: { org: ORG, slug: "linear" }, name: "Linear" },
  { ref: { org: ORG, slug: "notion" }, name: "Notion" },
];

const GUARD = create(HookConfigSchema, {
  format: HookFormat.CLAUDE_CODE,
  groups: [
    create(HookGroupSchema, {
      event: "PreToolUse",
      handlers: [create(HookHandlerSchema, { command: "python3", args: ["check.py", "${user_config.API_TOKEN}", "${user_config.REGION}"] })],
    }),
  ],
});
const HOOKS_OFFER: PluginOffer = { servers: [], hooks: { plugin: { org: ORG, slug: "guard" }, config: GUARD } };

function agent(
  slug: string,
  labels: Record<string, string>,
  listed: readonly string[],
  extra: { readonly hooks?: readonly string[]; readonly env?: readonly string[] } = {},
): Agent {
  return create(AgentSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `agt_${slug}`, org: ORG, slug, name: slug, labels }),
    spec: create(AgentSpecSchema, {
      instructions: "help",
      mcpServerUsages: listed.map((s) => create(McpServerUsageSchema, { mcpServerRef: create(ApiResourceReferenceSchema, { org: ORG, slug: s }) })),
      hooks: (extra.hooks ?? []).map((plugin) =>
        create(HookSourceSchema, { source: { case: "plugin", value: create(ApiResourceReferenceSchema, { org: ORG, slug: plugin }) } }),
      ),
      env: Object.fromEntries((extra.env ?? []).map((name) => [name, create(EnvVarDeclarationSchema, { description: "already here" })])),
    }),
  });
}

function setup(agents: Record<string, Agent>, refuseUpdate = false, offer: PluginOffer = { servers: SERVERS }) {
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
  const hook = renderHook(() => useAddPluginToAgent(offer), { wrapper });
  return { hook, updates };
}

describe("useAddPluginToAgent", () => {
  it("refuses an agent a plugin installed before any update, from its label", async () => {
    const { hook, updates } = setup({ assistant: agent("assistant", { "stigmer.ai/plugin": "plg_1" }, []) });
    act(() => hook.result.current.pick({ org: ORG, slug: "assistant" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("managed"));
    expect(await hook.result.current.add()).toEqual({ servers: 0, hooks: false, variables: [] });
    expect(updates).toEqual([]);
  });

  it("appends the servers the agent does not list, after the ones it has, and counts them", async () => {
    const { hook, updates } = setup({ reviewer: agent("reviewer", {}, ["notion"]) });
    act(() => hook.result.current.pick({ org: ORG, slug: "reviewer" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("ready"));
    expect(hook.result.current.phase).toMatchObject({ alreadyListed: ["Notion"] });

    let added = 0;
    await act(async () => {
      added = (await hook.result.current.add()).servers;
    });
    expect(added).toBe(1);
    expect(hook.result.current.phase).toMatchObject({ status: "added", outcome: { servers: 1, hooks: false } });
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

  it("switches a plugin's hooks on: the plugin appended to the agent's hooks, its variables declared as required secrets", async () => {
    const { hook, updates } = setup({ reviewer: agent("reviewer", {}, [], { hooks: ["other"], env: ["REGION"] }) }, false, HOOKS_OFFER);
    act(() => hook.result.current.pick({ org: ORG, slug: "reviewer" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("ready"));
    expect(hook.result.current.phase).toMatchObject({ hooksListed: false, variables: ["API_TOKEN"] });

    await act(async () => {
      expect(await hook.result.current.add()).toEqual({ servers: 0, hooks: true, variables: ["API_TOKEN"] });
    });
    const spec = updates[0]?.spec;
    expect(spec?.hooks.map((source) => (source.source.case === "plugin" ? source.source.value.slug : "inline"))).toEqual(["other", "guard"]);
    expect(spec?.env["API_TOKEN"]).toMatchObject({ isSecret: true, optional: false });
    expect(spec?.env["REGION"]).toMatchObject({ description: "already here", isSecret: false });
    expect(spec?.instructions).toBe("help");
  });

  it("keeps one source when the agent already runs the plugin's hooks", async () => {
    const { hook, updates } = setup({ reviewer: agent("reviewer", {}, [], { hooks: ["guard"], env: ["API_TOKEN", "REGION"] }) }, false, HOOKS_OFFER);
    act(() => hook.result.current.pick({ org: ORG, slug: "reviewer" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("ready"));
    expect(hook.result.current.phase).toMatchObject({ hooksListed: true, variables: [] });
    await act(async () => {
      expect(await hook.result.current.add()).toEqual({ servers: 0, hooks: false, variables: [] });
    });
    expect(updates[0]?.spec?.hooks).toHaveLength(1);
  });

  it("refuses a managed agent before switching hooks on", async () => {
    const { hook, updates } = setup({ assistant: agent("assistant", { "stigmer.ai/plugin": "plg_1" }, []) }, false, HOOKS_OFFER);
    act(() => hook.result.current.pick({ org: ORG, slug: "assistant" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("managed"));
    expect(updates).toEqual([]);
  });

  it("returns to picking on a cleared pick and on a read that fails, holding the error until cleared or reset", async () => {
    const { hook } = setup({ reviewer: agent("reviewer", {}, []) });
    act(() => hook.result.current.pick({ org: ORG, slug: "reviewer" }));
    await waitFor(() => expect(hook.result.current.phase.status).toBe("ready"));
    act(() => hook.result.current.pick(null));
    expect(hook.result.current.phase.status).toBe("picking");

    act(() => hook.result.current.pick({ org: ORG, slug: "ghost" }));
    await waitFor(() => expect(hook.result.current.error?.message).toMatch(/no agent/));
    expect(hook.result.current.phase.status).toBe("picking");
    act(() => hook.result.current.clearError());
    expect(hook.result.current.error).toBeNull();

    act(() => hook.result.current.pick({ org: ORG, slug: "ghost" }));
    await waitFor(() => expect(hook.result.current.error).not.toBeNull());
    act(() => hook.result.current.reset());
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.phase.status).toBe("picking");
  });
});
