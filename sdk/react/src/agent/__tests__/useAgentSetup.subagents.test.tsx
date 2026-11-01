/**
 * What a conversation with an agent asks for when the agent lists
 * subagents: the run reads each at the version the agent pinned, with its
 * keys, its own servers and its plugins (`runServers.ts`, the server's
 * `domain/run/run-subagents.ts`). Pinned:
 *
 * - a key a subagent declares is asked for when no vault the run reads
 *   holds it;
 * - a subagent's plugin server that signs in is a pending sign-in;
 * - a subagent of another organization closes My vault to the whole run,
 *   as the server does: the agent's own keys are asked of nobody, and a
 *   login in My vault serves none of its sign-ins;
 * - a subagent that cannot be read is left out, and the agent's own
 *   answer stands.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentVersionEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema, type Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { useAgentSetup } from "../useAgentSetup";
import { useMyVault } from "../../vault/useMyVault";

afterEach(cleanup);

const ORG = "acme";
const REF = { org: ORG, slug: "release-captain" };
const PIN = "b".repeat(64);
const CALENDAR_URL = "https://cal.example.com/mcp";

interface World {
  readonly spec: MessageInitShape<typeof AgentSpecSchema>;
  /** Each subagent's spec at its pin, by agent id; any other id cannot be read. */
  readonly subagents?: Readonly<Record<string, MessageInitShape<typeof AgentSpecSchema>>>;
  readonly plugins?: Readonly<Record<string, Plugin>>;
  /** Secret names My vault holds. */
  readonly secrets?: readonly string[];
  /** Addresses My vault holds a sign-in's login at. */
  readonly logins?: readonly string[];
}

function client(world: World) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(AgentQueryController, {
        getByReference: () =>
          create(AgentSchema, {
            metadata: create(ApiResourceMetadataSchema, { id: "agt_captain", org: ORG, slug: REF.slug, name: "Release captain" }),
            spec: create(AgentSpecSchema, world.spec),
          }),
        getVersion: (input) => {
          const found = world.subagents?.[input.agentId];
          if (found === undefined) throw new ConnectError(`no agent '${input.agentId}'`, Code.PermissionDenied);
          return create(AgentVersionEntrySchema, { versionHash: input.versionHash, specSnapshot: create(AgentSpecSchema, found) });
        },
      });
      service(PluginQueryController, {
        getByReference: (ref) => {
          const plugin = world.plugins?.[ref.slug];
          if (plugin === undefined) throw new ConnectError(`no plugin '${ref.slug}'`, Code.NotFound);
          return plugin;
        },
      });
      service(VaultQueryController, {
        getMine: () =>
          create(VaultSchema, {
            metadata: { org: ORG, slug: "mine" },
            spec: {
              owner: { case: "person", value: "ida_1" },
              secrets: Object.fromEntries((world.secrets ?? []).map((name) => [name, { description: "" }])),
              connections: Object.fromEntries(
                (world.logins ?? []).map((address) => [address, { source: VaultConnectionSource.sign_in, signIn: { loginApp: "" } }]),
              ),
            },
          }),
      });
    }),
  });
}

function wrapper(stigmer: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

/** Resolves the agent once My vault's first read has landed, as a composer does. */
async function resolve(world: World) {
  const rendered = renderHook(() => ({ setup: useAgentSetup(ORG), mine: useMyVault(ORG) }), {
    wrapper: wrapper(client(world)),
  });
  await waitFor(() => expect(rendered.result.current.mine.isLoading).toBe(false));
  let outcome: unknown;
  await act(async () => {
    outcome = await rendered.result.current.setup.resolveAgent(REF);
  });
  return outcome;
}

/** A plugin whose one server signs in at {@link CALENDAR_URL} (its login key CAL_TOKEN). */
const calendar = create(PluginSchema, {
  metadata: create(ApiResourceMetadataSchema, { id: "plg_calendar", org: ORG, slug: "calendar", name: "calendar" }),
  status: {
    mcpServers: [
      {
        name: "calendar",
        transport: { case: "http", value: { url: CALENDAR_URL, headers: { Authorization: "Bearer ${CAL_TOKEN}" } } },
        env: ["CAL_TOKEN"],
        signIn: { oauthOnly: true },
      },
    ],
    env: { CAL_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true }) },
  },
});

const secret = (description: string) => create(EnvVarDeclarationSchema, { isSecret: true, description });

describe("useAgentSetup and the agent's subagents", () => {
  it("asks for a key a subagent declares", async () => {
    const outcome = await resolve({
      spec: { subagents: [{ org: ORG, id: "agt_triager", version: PIN }] },
      subagents: { agt_triager: { env: { JIRA_TOKEN: secret("the triager's Jira key") } } },
    });
    expect(outcome).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [{ key: "JIRA_TOKEN", isSecret: true, description: "the triager's Jira key" }],
      pendingSignIns: [],
    });
  });

  it("is ready once a vault the run reads holds the subagent's key", async () => {
    const outcome = await resolve({
      spec: { subagents: [{ org: ORG, id: "agt_triager", version: PIN }] },
      subagents: { agt_triager: { env: { JIRA_TOKEN: secret("") } } },
      secrets: ["JIRA_TOKEN"],
    });
    expect(outcome).toMatchObject({ status: "ready", resolution: { mode: "saved" } });
  });

  it("owes the sign-in of a plugin a subagent lists", async () => {
    const outcome = await resolve({
      spec: { subagents: [{ org: ORG, id: "agt_planner", version: PIN }] },
      subagents: { agt_planner: { plugins: [{ slug: "calendar" }] } },
      plugins: { calendar },
    });
    expect(outcome).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [],
      pendingSignIns: [expect.objectContaining({ address: CALENDAR_URL, plugin: { org: ORG, slug: "calendar" } })],
    });
  });

  it("asks nothing of My vault for a run carrying another organization's subagent", async () => {
    const outcome = await resolve({
      spec: {
        env: { GITHUB_TOKEN: secret("") },
        subagents: [{ org: "globex", id: "agt_partner", version: PIN }],
      },
      subagents: { agt_partner: { env: { PARTNER_KEY: secret("") } } },
    });
    expect(outcome).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("counts no login in My vault for a run carrying another organization's subagent", async () => {
    const outcome = await resolve({
      spec: {
        plugins: [{ slug: "calendar" }],
        subagents: [{ org: "globex", id: "agt_partner", version: PIN }],
      },
      subagents: { agt_partner: {} },
      plugins: { calendar },
      logins: [CALENDAR_URL],
    });
    expect(outcome).toMatchObject({
      status: "needsEnvVars",
      pendingSignIns: [expect.objectContaining({ address: CALENDAR_URL })],
    });
  });

  it("leaves out a subagent it cannot read, and answers for the agent's own keys", async () => {
    const outcome = await resolve({
      spec: {
        env: { GITHUB_TOKEN: secret("") },
        subagents: [{ org: ORG, id: "agt_hidden", version: PIN }],
      },
    });
    expect(outcome).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [{ key: "GITHUB_TOKEN" }],
    });
  });
});
