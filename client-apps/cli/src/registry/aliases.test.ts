import { describe, expect, it } from "vitest";
import { generateAliases, normalizeAlias, pluralize, toKebabCase, toSnakeCase } from "./aliases.js";

function normalized(aliases: string[]): Set<string> {
  return new Set(aliases.map(normalizeAlias));
}

describe("generateAliases", () => {
  it("derives the full McpServer alias set", () => {
    const found = normalized(generateAliases("McpServer", "MCP Server", "mcp", "mcp_server"));
    for (const exp of [
      "mcpserver",
      "mcp-server",
      "mcp_server",
      "mcp",
      "mcpservers",
      "mcp-servers",
      "mcp_servers",
      "mcps",
    ]) {
      expect(found).toContain(exp);
    }
  });

  it("derives the Agent alias set", () => {
    const found = normalized(generateAliases("Agent", "Agent", "agt", "agent"));
    for (const exp of ["agent", "agt", "agents", "agts"]) {
      expect(found).toContain(exp);
    }
  });

  it("derives the Workflow alias set", () => {
    const found = normalized(generateAliases("Workflow", "Workflow", "wfl", "workflow"));
    for (const exp of ["workflow", "wfl", "workflows", "wfls"]) {
      expect(found).toContain(exp);
    }
  });

  it("derives the OAuthApp alias set including the canonical proto name", () => {
    // "OAuthApp" is the only kind whose PascalCase name has consecutive
    // capitals, so its split-derived forms (o-auth-app) diverge from the proto
    // enum name (oauth_app). Both families must be accepted: the canonical
    // spellings via protoName (stigmer/stigmer#470), and the historical
    // split-derived spellings for backward compatibility.
    const found = normalized(generateAliases("OAuthApp", "OAuth App", "oapp", "oauth_app"));
    for (const exp of [
      "oauth_app",
      "oauth-app",
      "oauth_apps",
      "oauth-apps",
      "oauthapp",
      "oauthapps",
      "o_auth_app",
      "o-auth-app",
      "oapp",
      "oapps",
    ]) {
      expect(found).toContain(exp);
    }
  });

  it("does not let a multi-word display name steal the parent's name", () => {
    // "Agent Instance" must NOT register "agent" (that belongs to Agent).
    const found = normalized(generateAliases("AgentInstance", "Agent Instance", "ain", "agent_instance"));
    expect(found).not.toContain("agent");
    expect(found).toContain("agentinstance");
    expect(found).toContain("agent-instance");
    expect(found).toContain("ain");
  });

  it("produces no duplicate normalized aliases", () => {
    // "agent" as protoName re-derives already-added forms — dedupe must hold.
    const aliases = generateAliases("Agent", "Agent", "agent", "agent");
    const lower = aliases.map(normalizeAlias);
    expect(new Set(lower).size).toBe(lower.length);
  });
});

describe("case conversion", () => {
  it.each([
    ["McpServer", "mcp-server"],
    ["Agent", "agent"],
    ["AgentInstance", "agent-instance"],
    ["WorkflowExecution", "workflow-execution"],
    ["", ""],
  ])("toKebabCase(%s) = %s", (input, expected) => {
    expect(toKebabCase(input)).toBe(expected);
  });

  it.each([
    ["McpServer", "mcp_server"],
    ["Agent", "agent"],
    ["AgentInstance", "agent_instance"],
    ["WorkflowExecution", "workflow_execution"],
    ["", ""],
  ])("toSnakeCase(%s) = %s", (input, expected) => {
    expect(toSnakeCase(input)).toBe(expected);
  });
});

describe("pluralize", () => {
  it.each([
    ["agent", "agents"],
    ["workflow", "workflows"],
    ["mcpserver", "mcpservers"],
    ["agents", "agents"],
    ["", ""],
  ])("pluralize(%s) = %s", (input, expected) => {
    expect(pluralize(input)).toBe(expected);
  });
});

describe("normalizeAlias", () => {
  it.each([
    ["Agent", "agent"],
    ["  agent  ", "agent"],
    ["MCP-Server", "mcp-server"],
    ["WORKFLOW", "workflow"],
    ["", ""],
  ])("normalizeAlias(%s) = %s", (input, expected) => {
    expect(normalizeAlias(input)).toBe(expected);
  });
});
