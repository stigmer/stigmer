/**
 * What a conversation with an agent asks for, read from every server a run
 * of it dials: the agent's own MCP servers beside its plugins', under the
 * server's one rule (`runServers.ts`). Pinned:
 *
 * - a key an agent's own server reads in a header is a required secret
 *   unless the agent's `env` declares it, and is asked for when no vault
 *   the run reads holds it;
 * - an agent server's `Authorization: Bearer ${NAME}` is satisfied by a
 *   login saved at the server's address, as a plugin's API-key server is;
 * - an agent server that sends no `Authorization` asks for nothing: its
 *   optional login is filled by a login at its address or not at all;
 * - a name the runner always fills (who is calling, the conversation) is
 *   never asked for, whichever home's server reads it. A plugin's server
 *   reading one used to land the composer in `needsEnvVars` for a value no
 *   vault can give (stigmer/stigmer#2306).
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
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema, type Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentSetup } from "../useAgentSetup";
import { useMyVault } from "../../vault/useMyVault";

afterEach(cleanup);

const ORG = "acme";
const REF = { org: ORG, slug: "support" };
const ZENDESK_URL = "https://acme-co.zendesk.com/mcp";

interface World {
  readonly spec: MessageInitShape<typeof AgentSpecSchema>;
  readonly plugins?: Readonly<Record<string, Plugin>>;
  /** Secret names My vault holds. */
  readonly secrets?: readonly string[];
  /** Addresses My vault holds a pasted login at. */
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
            metadata: create(ApiResourceMetadataSchema, { id: "agt_1", org: ORG, slug: REF.slug, name: "Support" }),
            spec: create(AgentSpecSchema, world.spec),
          }),
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
                (world.logins ?? []).map((address) => [address, { source: VaultConnectionSource.pasted }]),
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

function zendesk(headers: Record<string, string>) {
  return { name: "zendesk", url: ZENDESK_URL, headers };
}

describe("useAgentSetup and the agent's own MCP servers", () => {
  it("asks for a key the agent's server reads in a header, as a required secret", async () => {
    const outcome = await resolve({ spec: { mcpServers: [zendesk({ "X-Api-Key": "${ZENDESK_KEY}" })] } });
    expect(outcome).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [{ key: "ZENDESK_KEY", isSecret: true }],
    });
  });

  it("takes the agent's own declaration of a key its server reads", async () => {
    const outcome = await resolve({
      spec: {
        mcpServers: [zendesk({ "X-Region": "${ZENDESK_REGION}" })],
        env: { ZENDESK_REGION: create(EnvVarDeclarationSchema, { isSecret: false, optional: false, description: "eu or us" }) },
      },
    });
    expect(outcome).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [{ key: "ZENDESK_REGION", isSecret: false, description: "eu or us" }],
    });
  });

  it("is ready when My vault holds the key the server reads", async () => {
    const outcome = await resolve({
      spec: { mcpServers: [zendesk({ "X-Api-Key": "${ZENDESK_KEY}" })] },
      secrets: ["ZENDESK_KEY"],
    });
    expect(outcome).toMatchObject({ status: "ready", resolution: { mode: "saved" } });
  });

  it("counts a login at the server's address toward its Authorization key", async () => {
    const outcome = await resolve({
      spec: { mcpServers: [zendesk({ Authorization: "Bearer ${ZENDESK_TOKEN}" })] },
      logins: [ZENDESK_URL],
    });
    expect(outcome).toMatchObject({ status: "ready", resolution: { mode: "saved" } });
  });

  it("asks nothing of a server that sends no Authorization: its login is optional and never typed", async () => {
    const outcome = await resolve({ spec: { mcpServers: [zendesk({})] } });
    expect(outcome).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("never asks for a value the runner fills, read by the agent's own server", async () => {
    const outcome = await resolve({
      spec: { mcpServers: [zendesk({ "X-Caller": "${STIGMER_CALLER_IDENTITY_VALUE}", "X-Session": "${STIGMER_SESSION_ID}" })] },
    });
    expect(outcome).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("never asks for a value the runner fills, read by a plugin's server (stigmer/stigmer#2306)", async () => {
    // The plugin reader declares a platform variable the way it reaches the
    // console: optional, no secret.
    const caller = create(PluginSchema, {
      metadata: create(ApiResourceMetadataSchema, { id: "plg_crm", org: ORG, slug: "crm", name: "crm" }),
      status: {
        mcpServers: [
          {
            name: "crm",
            transport: { case: "http", value: { url: "https://crm.example/mcp", headers: { "X-Caller": "${STIGMER_CALLER_IDENTITY_VALUE}" } } },
            env: ["STIGMER_CALLER_IDENTITY_VALUE"],
          },
        ],
        env: { STIGMER_CALLER_IDENTITY_VALUE: create(EnvVarDeclarationSchema, { isSecret: false, optional: true }) },
      },
    });
    const outcome = await resolve({ spec: { plugins: [{ org: ORG, slug: "crm" }] }, plugins: { crm: caller } });
    expect(outcome).toMatchObject({ status: "ready", resolution: { mode: "direct" } });
  });

  it("reads the agent's own servers and its plugins' together", async () => {
    const search = create(PluginSchema, {
      metadata: create(ApiResourceMetadataSchema, { id: "plg_search", org: ORG, slug: "search", name: "search" }),
      status: {
        mcpServers: [{ name: "search", transport: { case: "stdio", value: { command: "npx", args: [] } }, env: ["SEARCH_KEY"] }],
      },
    });
    const outcome = await resolve({
      spec: { mcpServers: [zendesk({ "X-Api-Key": "${ZENDESK_KEY}" })], plugins: [{ org: ORG, slug: "search" }] },
      plugins: { search },
    });
    expect(outcome).toMatchObject({ status: "needsEnvVars" });
    const asked = (outcome as { missingVariables: { key: string }[] }).missingVariables.map((variable) => variable.key);
    expect(asked.sort()).toEqual(["SEARCH_KEY", "ZENDESK_KEY"]);
  });
});
