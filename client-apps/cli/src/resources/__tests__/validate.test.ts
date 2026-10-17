// Unit tests for offline validation: the schema each file-based kind resolves
// to, and the structural decode of a document against it.

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";
import { schemaForValidate, validateDocument } from "../validate.js";

describe("schemaForValidate", () => {
  it("resolves a schema for each file-based kind", () => {
    expect(schemaForValidate(ApiResourceKind.agent)).toBeDefined();
  });

  it("returns undefined for non-file-based kinds", () => {
    expect(schemaForValidate(ApiResourceKind.organization)).toBeUndefined();
    expect(schemaForValidate(ApiResourceKind.api_key)).toBeUndefined();
  });
});

describe("validateDocument", () => {
  const agentSchema = schemaForValidate(ApiResourceKind.agent);
  if (agentSchema === undefined) throw new Error("agent schema unavailable");

  it("accepts a structurally valid agent document", () => {
    expect(() =>
      validateDocument(agentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { name: "Reviewer", slug: "reviewer", org: "acme" },
        spec: { description: "reviews code" },
      }),
    ).not.toThrow();
  });

  it.each(["mcp_servers", "mcpServers"])("accepts an agent writing its own MCP servers under %s", (field) => {
    expect(() =>
      validateDocument(agentSchema, {
        kind: "Agent",
        metadata: { name: "Support", slug: "support", org: "acme" },
        spec: { [field]: [{ name: "zendesk", url: "https://acme-co.zendesk.com/mcp", headers: { "X-Api-Key": "${ZENDESK_KEY}" } }] },
      }),
    ).not.toThrow();
  });

  it("refuses an agent listing mcp_server_usages, naming the way forward", () => {
    expect(() =>
      validateDocument(agentSchema, {
        kind: "Agent",
        metadata: { name: "Reviewer" },
        spec: { mcp_server_usages: [{ mcp_server_ref: { slug: "github" } }] },
      }),
    ).toThrow(/mcp_server_usages is no longer read\. An agent lists its own MCP servers under `mcp_servers`.*`stigmer mcp add <name> <url>`/);
  });

  it("refuses an agent writing sub_agents, naming the way forward", () => {
    expect(() =>
      validateDocument(agentSchema, {
        kind: "Agent",
        metadata: { name: "Reviewer" },
        spec: { sub_agents: [{ inline_spec: { name: "helper" } }] },
      }),
    ).toThrow(/^sub_agents is no longer read\. A subagent is now a saved agent:.*`subagents`/);
  });

  it("ignores unknown fields for forward compatibility", () => {
    expect(() =>
      validateDocument(agentSchema, {
        kind: "Agent",
        metadata: { name: "Reviewer" },
        spec: { description: "reviews code" },
        somethingNewerServersAdd: true,
      }),
    ).not.toThrow();
  });

  it("rejects a document with a type-mismatched field", () => {
    expect(() =>
      validateDocument(agentSchema, {
        kind: "Agent",
        // metadata must be an object, not a string.
        metadata: "not-an-object",
      }),
    ).toThrow();
  });
});
