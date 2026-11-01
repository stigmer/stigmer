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
 * - a name two declarers read takes the declaration that asks the most:
 *   one needing a value over one that fills itself (either order), then
 *   required over optional, then the first seen, the agent's own servers
 *   read first; secret when either declaration is; a plugin's hooks
 *   reading a name undeclared make it required even when another plugin's
 *   server declares it optional;
 * - the subagents an agent lists are read at their pinned versions, in
 *   the order listed: their servers after the agent's own, their plugins
 *   after the agent's and each once (a reference with no organization
 *   names the subagent's), and a subagent that cannot be read or an empty
 *   reference is left out;
 * - each subagent's organization is read from its reference alone;
 * - the run's keys are its tools' and hooks', then each agent's own for a
 *   key no tool reads: a tool's declaration stands over any agent's.
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
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentVersionEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { type Plugin, PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { EnvVarDeclarationSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";

import {
  agentServerEntry,
  agentUsesTools,
  declarationsOf,
  pluginReadings,
  readAgentServers,
  runDeclarations,
  type RunReading,
  serversOf,
  signInKeys,
  signInServers,
  strongerDeclaration,
  subagentOrgs,
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

/** The hash a subagent reference pins in these tests. */
const PIN = "a".repeat(64);

/** Every read a {@link client} answered, in order. */
interface Reads {
  readonly plugins: { org: string; slug: string }[];
  readonly versions: { agentId: string; versionHash: string }[];
}

/**
 * A client whose plugins are `plugins` by slug and whose agents' pinned
 * versions are `agents` by id; any other slug or id is not found.
 */
function client(
  plugins: Readonly<Record<string, Plugin>>,
  agents: Readonly<Record<string, MessageInitShape<typeof AgentSpecSchema>>> = {},
  reads: Reads = { plugins: [], versions: [] },
) {
  return {
    plugin: {
      getByReference: async (ref: { org: string; slug: string }) => {
        reads.plugins.push({ org: ref.org, slug: ref.slug });
        const found = plugins[ref.slug];
        if (found === undefined) throw new ConnectError(`no plugin '${ref.slug}'`, Code.NotFound);
        return found;
      },
    },
    agent: {
      getVersion: async (input: { agentId: string; versionHash: string }) => {
        reads.versions.push({ agentId: input.agentId, versionHash: input.versionHash });
        const found = agents[input.agentId];
        if (found === undefined) throw new ConnectError(`no agent '${input.agentId}'`, Code.NotFound);
        return create(AgentVersionEntrySchema, { versionHash: input.versionHash, specSnapshot: spec(found) });
      },
    },
  } as unknown as Parameters<typeof readAgentServers>[0];
}

function declaration(init: MessageInitShape<typeof EnvVarDeclarationSchema>) {
  return create(EnvVarDeclarationSchema, init);
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

  it("declares each key once, a required declaration winning over an optional one, the agent's own servers first", async () => {
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
    // The second plugin requires SEARCH_KEY: the run refuses without it.
    expect(declarations.SEARCH_KEY).toMatchObject({ isSecret: true, optional: false });
    // The agent's server read REGION first and requires it: its declaration
    // stands over the first plugin's undeclared, equally required, read,
    // and is secret because that read treats REGION as one.
    expect(declarations.REGION).toMatchObject({ isSecret: true, optional: false });
  });

  it("asks for a key one plugin fills itself when another needs a value for it, in either order", () => {
    const filled = pluginReadings(
      { org: "acme", slug: "eu" },
      plugin("eu", "eu", {
        mcpServers: [{ name: "eu", transport: { case: "stdio", value: { command: "eu", args: [] } }, env: ["REGION"] }],
        env: { REGION: declaration({ isSecret: false, value: "eu" }) },
      }),
    );
    const needs = pluginReadings(
      { org: "acme", slug: "any" },
      plugin("any", "any", {
        mcpServers: [{ name: "any", transport: { case: "stdio", value: { command: "any", args: [] } }, env: ["REGION"] }],
      }),
    );

    for (const [first, second] of [
      [filled, needs],
      [needs, filled],
    ] as const) {
      const declarations = declarationsOf({ servers: [...first.servers, ...second.servers], hooks: [] });
      expect(declarations.REGION).toMatchObject({ isSecret: true, optional: false });
    }
  });

  it("keeps the first of two optional declarations, and a hook's undeclared read makes a name required", () => {
    const optional = (description: string) => create(EnvVarDeclarationSchema, { isSecret: false, optional: true, description });
    const first = pluginReadings(
      { org: "acme", slug: "a" },
      plugin("a", "a", {
        mcpServers: [{ name: "a", transport: { case: "stdio", value: { command: "a", args: [] } }, env: ["REGION", "TOKEN"] }],
        env: { REGION: optional("first"), TOKEN: optional("optional here") },
      }),
    );
    const second = pluginReadings(
      { org: "acme", slug: "b" },
      plugin("b", "b", {
        mcpServers: [{ name: "b", transport: { case: "stdio", value: { command: "b", args: [] } }, env: ["REGION"] }],
        env: { REGION: optional("second") },
        hooks: { groups: [{ matcher: "*", handlers: [{ command: "audit", args: ["${user_config.TOKEN}"] }] }] },
      }),
    );

    const declarations = declarationsOf({ servers: [...first.servers, ...second.servers], hooks: [...first.hooks, ...second.hooks] });
    expect(declarations.REGION).toMatchObject({ optional: true, description: "first" });
    // Plugin b's hook reads TOKEN undeclared, a required secret, whatever plugin a's server says.
    expect(declarations.TOKEN).toMatchObject({ isSecret: true, optional: false });
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

describe("readAgentServers and the agent's subagents", () => {
  it("reads each subagent at its pin: its servers after the agent's, its plugins after the agent's, each plugin once", async () => {
    const searchPlugin = plugin("search", "search", {
      mcpServers: [{ name: "search", transport: { case: "stdio", value: { command: "search", args: [] } }, env: ["SEARCH_KEY"] }],
    });
    const reads: Reads = { plugins: [], versions: [] };
    const reading = await readAgentServers(
      client(
        { search: searchPlugin, tracker: plugin("tracker", "tracker"), wiki: plugin("wiki", "wiki") },
        {
          agt_jira: {
            mcpServers: [{ name: "jira", url: "https://jira.example/mcp", headers: { "X-Token": "${JIRA_TOKEN}" } }],
            env: { JIRA_TOKEN: declaration({ isSecret: true, description: "jira" }) },
            plugins: [{ slug: "search" }, { slug: "tracker" }],
          },
          agt_wiki: { plugins: [{ slug: "wiki" }] },
        },
        reads,
      ),
      spec({
        mcpServers: [{ name: "zendesk", url: ZENDESK_URL, headers: { "X-Api-Key": "${ZENDESK_KEY}" } }],
        env: { GITHUB_TOKEN: declaration({ isSecret: true }) },
        plugins: [{ slug: "search" }],
        subagents: [
          { org: "acme", id: "agt_jira", version: PIN },
          { org: "globex", id: "agt_wiki", version: PIN },
        ],
      }),
      "acme",
      { plugins: "throw" },
    );

    expect(reads.versions).toEqual([
      { agentId: "agt_jira", versionHash: PIN },
      { agentId: "agt_wiki", versionHash: PIN },
    ]);
    // The agent's own plugin first; the jira subagent's search is the agent's
    // and read once; the wiki subagent's reference names its own organization.
    expect(reads.plugins).toEqual([
      { org: "acme", slug: "search" },
      { org: "acme", slug: "tracker" },
      { org: "globex", slug: "wiki" },
    ]);
    expect(serversOf(reading).map((server) => server.name)).toEqual(["zendesk", "jira", "search"]);
    // The subagent's server takes the subagent's own declaration.
    expect(declarationsOf(reading).JIRA_TOKEN).toMatchObject({ isSecret: true, description: "jira" });
    expect(reading.agents.map((agent) => Object.keys(agent.env))).toEqual([["GITHUB_TOKEN"], ["JIRA_TOKEN"], []]);
  });

  it("leaves out a subagent it cannot read and an empty reference, and keeps the rest", async () => {
    const reads: Reads = { plugins: [], versions: [] };
    const reading = await readAgentServers(
      client({}, { agt_jira: { env: { JIRA_TOKEN: declaration({ isSecret: true }) } } }, reads),
      spec({
        subagents: [{ org: "acme", id: "agt_gone", version: PIN }, {}, { org: "acme", id: "agt_jira", version: PIN }],
      }),
      "acme",
      { plugins: "throw" },
    );

    expect(reads.versions.map((read) => read.agentId)).toEqual(["agt_gone", "agt_jira"]);
    expect(reading.agents.map((agent) => Object.keys(agent.env))).toEqual([[], ["JIRA_TOKEN"]]);
    expect(Object.keys(runDeclarations(reading))).toEqual(["JIRA_TOKEN"]);
  });
});

describe("subagentOrgs", () => {
  it("names each listed subagent's organization, the default for a reference that names none, skipping an empty one", () => {
    expect(
      subagentOrgs(spec({ subagents: [{ org: "globex", id: "agt_1" }, { id: "agt_2" }, {}] }), "acme"),
    ).toEqual(["globex", "acme"]);
    expect(subagentOrgs(undefined, "acme")).toEqual([]);
  });
});

describe("runDeclarations and strongerDeclaration", () => {
  /** A reading whose one plugin server reads `toolKeys` under `toolEnv`, and whose agents declare `agents`. */
  function reading(
    toolKeys: readonly string[],
    toolEnv: Record<string, ReturnType<typeof declaration>>,
    ...agents: Record<string, ReturnType<typeof declaration>>[]
  ): RunReading {
    const tool = pluginReadings(
      { org: "acme", slug: "tool" },
      plugin("tool", "tool", {
        mcpServers: [{ name: "tool", transport: { case: "stdio", value: { command: "tool", args: [] } }, env: [...toolKeys] }],
        env: toolEnv,
      }),
    );
    return { ...tool, agents: agents.map((env) => ({ env })) };
  }

  it("takes a tool's declaration of a key over the agent's and a subagent's, as the run counts it", () => {
    const declarations = runDeclarations(
      reading(
        ["TOKEN"],
        { TOKEN: declaration({ isSecret: false, optional: true, description: "the tool's" }) },
        { TOKEN: declaration({ isSecret: true, optional: false, description: "the agent's" }) },
        { TOKEN: declaration({ isSecret: true, optional: false, description: "the subagent's" }) },
      ),
    );
    expect(declarations.TOKEN).toMatchObject({ isSecret: false, optional: true, description: "the tool's" });
  });

  it("lists the tools' keys first, then each agent's own, the agent before its subagents", () => {
    const declarations = runDeclarations(
      reading(
        ["TOOL_KEY"],
        {},
        { GITHUB_TOKEN: declaration({ isSecret: true }) },
        { JIRA_TOKEN: declaration({ isSecret: true }) },
      ),
    );
    expect(Object.keys(declarations)).toEqual(["TOOL_KEY", "GITHUB_TOKEN", "JIRA_TOKEN"]);
  });

  it("asks with a required declaration over an optional one across agents", () => {
    const declarations = runDeclarations(
      reading(
        [],
        {},
        { JIRA_TOKEN: declaration({ isSecret: true, optional: true, description: "the agent's" }) },
        { JIRA_TOKEN: declaration({ isSecret: true, optional: false, description: "the subagent's" }) },
      ),
    );
    expect(declarations.JIRA_TOKEN).toMatchObject({ optional: false, description: "the subagent's" });
  });

  it("asks for a value one agent fills itself when another agent needs one, in either order", () => {
    const filled = { REGION: declaration({ isSecret: false, value: "eu" }) };
    const needs = { REGION: declaration({ isSecret: true, description: "your region" }) };
    expect(runDeclarations(reading([], {}, filled, needs)).REGION).toMatchObject({ isSecret: true, description: "your region" });
    expect(runDeclarations(reading([], {}, needs, filled)).REGION).toMatchObject({ isSecret: true, description: "your region" });
  });

  it("keeps the first of two equal declarations, secret when either is", () => {
    const merged = strongerDeclaration(
      declaration({ isSecret: false, optional: false, description: "first" }),
      declaration({ isSecret: true, optional: false, description: "second" }),
    );
    expect(merged).toMatchObject({ isSecret: true, optional: false, description: "first" });

    const plain = declaration({ isSecret: false, optional: true, description: "first" });
    expect(strongerDeclaration(plain, declaration({ isSecret: false, optional: true }))).toBe(plain);
    // Two that fill themselves: the first value stands, never made secret.
    const eu = declaration({ isSecret: false, value: "eu" });
    expect(strongerDeclaration(eu, declaration({ isSecret: false, value: "us" }))).toBe(eu);
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
