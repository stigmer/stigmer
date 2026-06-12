import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";
import { defaultRegistry } from "./registry.js";
import { Verb } from "./verbs.js";

const registry = defaultRegistry();

describe("registry — alias resolution", () => {
  it.each([
    ["mcp", ApiResourceKind.mcp_server],
    ["mcp-server", ApiResourceKind.mcp_server],
    ["mcp_server", ApiResourceKind.mcp_server],
    ["McpServer", ApiResourceKind.mcp_server],
    ["mcpservers", ApiResourceKind.mcp_server],
    ["agent", ApiResourceKind.agent],
    ["agents", ApiResourceKind.agent],
    ["agt", ApiResourceKind.agent],
    ["workflow", ApiResourceKind.workflow],
    ["wfl", ApiResourceKind.workflow],
    ["org", ApiResourceKind.organization],
    ["oapp", ApiResourceKind.oauth_app],
  ])("resolves %s -> kind", (alias, kind) => {
    expect(registry.getByAlias(alias)?.kind).toBe(kind);
  });

  it("resolution is case-insensitive", () => {
    expect(registry.getByAlias("MCP-SERVER")?.kind).toBe(ApiResourceKind.mcp_server);
  });

  it("returns undefined for an unknown alias", () => {
    expect(registry.getByAlias("nope")).toBeUndefined();
  });

  it("does not register agent_execution as an addressable type", () => {
    expect(registry.getByKind(ApiResourceKind.agent_execution)).toBeUndefined();
  });
});

describe("registry — YAML kind resolution", () => {
  it("resolves the exact YAML kind", () => {
    expect(registry.getByYamlKind("McpServer")?.kind).toBe(ApiResourceKind.mcp_server);
    expect(registry.getByYamlKind("Workflow")?.kind).toBe(ApiResourceKind.workflow);
  });
});

describe("registry — verb support matrix", () => {
  it("agent supports read + run + search verbs", () => {
    for (const v of [Verb.Apply, Verb.Validate, Verb.Get, Verb.List, Verb.Delete, Verb.Run, Verb.Search]) {
      expect(registry.supportsVerb(ApiResourceKind.agent, v)).toBe(true);
    }
    expect(registry.supportsVerb(ApiResourceKind.agent, Verb.Push)).toBe(false);
  });

  it("skill supports push but not apply", () => {
    expect(registry.supportsVerb(ApiResourceKind.skill, Verb.Push)).toBe(true);
    expect(registry.supportsVerb(ApiResourceKind.skill, Verb.Apply)).toBe(false);
  });

  it("workflow_instance has no list verb", () => {
    expect(registry.supportsVerb(ApiResourceKind.workflow_instance, Verb.Get)).toBe(true);
    expect(registry.supportsVerb(ApiResourceKind.workflow_instance, Verb.List)).toBe(false);
  });

  it("typesForVerb(get) includes the core read kinds", () => {
    const kinds = new Set(registry.typesForVerb(Verb.Get).map((t) => t.kind));
    expect(kinds).toContain(ApiResourceKind.agent);
    expect(kinds).toContain(ApiResourceKind.workflow);
    expect(kinds).toContain(ApiResourceKind.mcp_server);
  });
});

describe("registry — completeness", () => {
  it("registers every CLI-relevant kind with metadata", () => {
    for (const info of registry.all()) {
      expect(info.name).not.toBe("");
      expect(info.singular).toBe(info.name.toLowerCase());
      expect(info.aliases.length).toBeGreaterThan(0);
    }
  });
});
