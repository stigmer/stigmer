/**
 * The console's reading of every MCP server a run dials, against the
 * server's own rule (`domain/run/run-servers.ts` and `domain/vault/resolve.ts`
 * in the server, whose tests `run-servers.test.ts` and
 * `agent-servers.test.ts` pin the same cases). Pinned:
 *
 * - an agent's own server reads as an HTTP entry at its URL whose `env`
 *   is the `${NAME}`s its headers read, sorted, each once;
 * - a name it reads takes the agent's `env` declaration, else a platform
 *   variable's (optional, no secret), else it is a required secret;
 * - a plugin's server takes the plugin's declaration, else a required
 *   secret, and its hooks' names count too;
 * - a name the runner always fills is no requirement, for either home;
 * - a name two homes read keeps the first declaration, the agent's own
 *   servers read first;
 * - the servers that sign in are a plugin's, one per address, named by
 *   the first plugin to list it (by its name, else its slug); an agent's
 *   server never has a sign-in record;
 * - reading the plugins either fails on one that cannot be read or leaves
 *   it out, as the caller asks;
 * - an agent uses tools when it lists a plugin or writes a server.
 */

import { describe, expect, it } from "vitest";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { type Plugin, PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";

import {
  agentServerEntry,
  agentUsesTools,
  declarationsOf,
  pluginReadings,
  readAgentServers,
  serversOf,
  signInKeys,
  signInServers,
} from "../runServers.js";

const LINEAR_URL = "https://mcp.linear.app/mcp";
const ZENDESK_URL = "https://acme-co.zendesk.com/mcp";

function plugin(slug: string, name: string, status?: MessageInitShape<typeof PluginStatusSchema>): Plugin {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `plg_${slug}`, org: "acme", slug, name }),
    ...(status !== undefined && { status }),
  });
}

function spec(init: MessageInitShape<typeof AgentSpecSchema>) {
  return create(AgentSpecSchema, init);
}

/** A client whose plugins are `plugins` by slug; any other slug is not found. */
function client(plugins: Readonly<Record<string, Plugin>>) {
  return {
    plugin: {
      getByReference: async (ref: { org: string; slug: string }) => {
        const found = plugins[ref.slug];
        if (found === undefined) throw new ConnectError(`no plugin '${ref.slug}'`, Code.NotFound);
        return found;
      },
    },
  } as unknown as Parameters<typeof readAgentServers>[0];
}

describe("agentServerEntry", () => {
  it("reads an agent's server as an HTTP entry naming each value its headers read, sorted, once", () => {
    const entry = agentServerEntry({
      name: "zendesk",
      url: ZENDESK_URL,
      headers: { "X-Api-Key": "${ZENDESK_KEY}", "X-Both": "${REGION}-${ZENDESK_KEY}", Accept: "application/json" },
    });
    expect(entry.name).toBe("zendesk");
    expect(entry.transport).toMatchObject({ case: "http", value: { url: ZENDESK_URL, headers: { Accept: "application/json" } } });
    expect(entry.env).toEqual(["REGION", "ZENDESK_KEY"]);
    expect(entry.signIn).toBeUndefined();
  });
});

describe("declarationsOf", () => {
  it("declares an agent server's names by the agent's env, else a platform variable's, else a required secret", async () => {
    const reading = await readAgentServers(
      client({}),
      spec({
        mcpServers: [
          {
            name: "zendesk",
            url: ZENDESK_URL,
            headers: { "X-Api-Key": "${ZENDESK_KEY}", "X-Region": "${REGION}", "X-Back": "${STIGMER_SERVER_ADDRESS}" },
          },
        ],
        env: { REGION: create(EnvVarDeclarationSchema, { isSecret: false, optional: true, description: "eu or us" }) },
      }),
      "acme",
      { plugins: "throw" },
    );

    const declarations = declarationsOf(reading);
    expect(declarations.ZENDESK_KEY).toMatchObject({ isSecret: true, optional: false });
    expect(declarations.REGION).toMatchObject({ isSecret: false, optional: true, description: "eu or us" });
    // The server's address is the one platform variable a person may save.
    expect(declarations.STIGMER_SERVER_ADDRESS).toMatchObject({ isSecret: false, optional: true });
  });

  it("asks for no name the runner always fills, read by either home's server or a plugin's hooks", async () => {
    const crm = plugin("crm", "crm", {
      mcpServers: [{ name: "crm", transport: { case: "http", value: { url: "https://crm.example/mcp" } }, env: ["STIGMER_SESSION_ID"] }],
      env: { STIGMER_SESSION_ID: create(EnvVarDeclarationSchema, { isSecret: false, optional: true }) },
      // An exec-form handler reads a variable as `${user_config.KEY}`.
      hooks: { groups: [{ matcher: "*", handlers: [{ command: "audit", args: ["${user_config.STIGMER_CALLER_IDENTITY_KIND}"] }] }] },
    });
    const reading = await readAgentServers(
      client({ crm }),
      spec({
        mcpServers: [{ name: "zendesk", url: ZENDESK_URL, headers: { "X-Caller": "${STIGMER_CALLER_IDENTITY_VALUE}" } }],
        plugins: [{ slug: "crm" }],
      }),
      "acme",
      { plugins: "throw" },
    );

    expect(declarationsOf(reading)).toEqual({});
  });

  it("declares each key a plugin's server reads once, the first declaration kept, the agent's own servers first", async () => {
    const first = plugin("search", "search", {
      mcpServers: [{ name: "search", transport: { case: "stdio", value: { command: "npx", args: [] } }, env: ["SEARCH_KEY", "REGION"] }],
      env: { SEARCH_KEY: create(EnvVarDeclarationSchema, { isSecret: false, optional: true }) },
    });
    const second = plugin("other", "other", {
      mcpServers: [{ name: "other", transport: { case: "stdio", value: { command: "npx", args: [] } }, env: ["SEARCH_KEY"] }],
      env: { SEARCH_KEY: create(EnvVarDeclarationSchema, { isSecret: true, optional: false }) },
    });
    const reading = await readAgentServers(
      client({ bare: plugin("bare", "bare"), search: first, other: second }),
      spec({
        mcpServers: [{ name: "zendesk", url: ZENDESK_URL, headers: { "X-Region": "${REGION}" } }],
        env: { REGION: create(EnvVarDeclarationSchema, { isSecret: false, optional: false }) },
        plugins: [{ slug: "bare" }, { slug: "search" }, { slug: "other" }],
      }),
      "acme",
      { plugins: "throw" },
    );

    const declarations = declarationsOf(reading);
    expect(Object.keys(declarations)).toEqual(["REGION", "SEARCH_KEY"]);
    expect(declarations.SEARCH_KEY).toMatchObject({ isSecret: false, optional: true });
    // The agent's server read REGION first: its declaration stands.
    expect(declarations.REGION).toMatchObject({ isSecret: false, optional: false });
  });

  it("makes a key no home declares a required secret", () => {
    const declarations = declarationsOf(
      pluginReadings(
        { org: "acme", slug: "search" },
        plugin("search", "search", {
          mcpServers: [{ name: "search", transport: { case: "stdio", value: { command: "npx", args: [] } }, env: ["REGION"] }],
        }),
      ),
    );
    expect(declarations.REGION).toMatchObject({ isSecret: true, optional: false });
  });

  it("reads nothing from a plugin with no status", () => {
    expect(pluginReadings({ org: "acme", slug: "bare" }, plugin("bare", "bare"))).toEqual({ servers: [], hooks: [] });
  });
});

describe("signInServers and signInKeys", () => {
  it("lists a plugin's servers that sign in, one per address, named by the first plugin that lists it", async () => {
    const linear = plugin("linear", "", {
      mcpServers: [
        {
          name: "linear",
          transport: { case: "http", value: { url: LINEAR_URL, headers: { Authorization: "Bearer ${LINEAR_ACCESS_TOKEN}" } } },
          signIn: {},
        },
        { name: "open", transport: { case: "http", value: { url: "https://open.example/mcp" } } },
        { name: "local", transport: { case: "stdio", value: { command: "npx", args: [] } }, env: ["KEY"] },
      ],
    });
    const again = plugin("linear-too", "Linear too", {
      mcpServers: [{ name: "linear", transport: { case: "http", value: { url: LINEAR_URL } }, signIn: {} }],
    });
    const reading = await readAgentServers(
      client({ linear, "linear-too": again }),
      spec({
        // An agent's own server at the same address never signs in by record.
        mcpServers: [{ name: "linear-direct", url: LINEAR_URL, headers: {} }],
        plugins: [{ slug: "linear" }, { org: "acme", slug: "linear-too" }],
      }),
      "acme",
      { plugins: "throw" },
    );

    const servers = signInServers(reading);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ plugin: { org: "acme", slug: "linear" }, pluginName: "linear", address: LINEAR_URL });
    expect([...signInKeys(reading)]).toEqual(["LINEAR_ACCESS_TOKEN"]);
    // Every server is matched against the vault's logins, the agent's first.
    expect(serversOf(reading).map((server) => server.name)).toEqual(["linear-direct", "linear", "open", "local", "linear"]);
  });
});

describe("readAgentServers", () => {
  it("fails on a plugin it cannot read, or leaves it out, as asked", async () => {
    const agent = spec({
      mcpServers: [{ name: "zendesk", url: ZENDESK_URL, headers: { "X-Api-Key": "${ZENDESK_KEY}" } }],
      plugins: [{ slug: "ghost" }],
    });
    await expect(readAgentServers(client({}), agent, "acme", { plugins: "throw" })).rejects.toThrow(/no plugin 'ghost'/);

    const reading = await readAgentServers(client({}), agent, "acme", { plugins: "skip" });
    expect(Object.keys(declarationsOf(reading))).toEqual(["ZENDESK_KEY"]);
  });
});

describe("agentUsesTools", () => {
  it("is true for an agent that lists a plugin or writes a server, and false otherwise", () => {
    expect(agentUsesTools(spec({ plugins: [{ slug: "linear" }] }))).toBe(true);
    expect(agentUsesTools(spec({ mcpServers: [{ name: "zendesk", url: ZENDESK_URL }] }))).toBe(true);
    expect(agentUsesTools(spec({}))).toBe(false);
    expect(agentUsesTools(undefined)).toBe(false);
  });
});
