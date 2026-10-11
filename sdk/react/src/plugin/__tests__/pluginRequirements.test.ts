/**
 * What the plugins an agent lists ask of the person running it. Pins: every
 * key a plugin's servers read is declared by the plugin, or else a required
 * secret; a name two plugins read keeps the first declaration; a plugin with
 * no status asks for nothing; the servers that sign in are one per address,
 * the first plugin to list an address naming it, by the plugin's name or
 * else its slug; a key-taking or local server signs in nowhere.
 */

import { describe, expect, it } from "vitest";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { type Plugin, PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";

import { pluginDeclarations, signInServers } from "../pluginRequirements.js";

const LINEAR_URL = "https://mcp.linear.app/mcp";

function plugin(slug: string, name: string, status?: MessageInitShape<typeof PluginStatusSchema>): Plugin {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `plg_${slug}`, org: "acme", slug, name }),
    ...(status !== undefined && { status }),
  });
}

describe("pluginDeclarations", () => {
  it("declares each key a server reads once, the first plugin's declaration kept", () => {
    const first = plugin("search", "search", {
      mcpServers: [{ name: "search", transport: { case: "stdio", value: { command: "npx", args: [] } }, env: ["SEARCH_KEY", "REGION"] }],
      env: { SEARCH_KEY: create(EnvVarDeclarationSchema, { isSecret: false, optional: true }) },
    });
    const second = plugin("other", "other", {
      mcpServers: [{ name: "other", transport: { case: "stdio", value: { command: "npx", args: [] } }, env: ["SEARCH_KEY"] }],
      env: { SEARCH_KEY: create(EnvVarDeclarationSchema, { isSecret: true, optional: false }) },
    });

    const declarations = pluginDeclarations([plugin("bare", "bare"), first, second]);

    expect(Object.keys(declarations)).toEqual(["SEARCH_KEY", "REGION"]);
    expect(declarations.SEARCH_KEY).toMatchObject({ isSecret: false, optional: true });
    // A key no plugin declares is a required secret.
    expect(declarations.REGION).toMatchObject({ isSecret: true, optional: false });
  });
});

describe("signInServers", () => {
  it("lists one server per address, named by the first plugin that lists it", () => {
    const linear = plugin("linear", "", {
      mcpServers: [
        { name: "linear", transport: { case: "http", value: { url: LINEAR_URL } }, signIn: {} },
        { name: "open", transport: { case: "http", value: { url: "https://open.example/mcp" } } },
        { name: "local", transport: { case: "stdio", value: { command: "npx", args: [] } }, env: ["KEY"] },
      ],
    });
    const again = plugin("linear-too", "Linear too", {
      mcpServers: [{ name: "linear", transport: { case: "http", value: { url: LINEAR_URL } }, signIn: {} }],
    });

    const servers = signInServers([
      { ref: { org: "acme", slug: "linear" }, plugin: linear },
      { ref: { org: "acme", slug: "linear-too" }, plugin: again },
    ]);

    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ plugin: { org: "acme", slug: "linear" }, pluginName: "linear", address: LINEAR_URL });
  });
});
