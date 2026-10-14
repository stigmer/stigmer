/**
 * The checks an agent's MCP server editor runs before a save, against the
 * server's own save rule (`ValidateMcpServers`): a name in the tool-list
 * grammar, never reserved, used once; an https URL (http on this machine)
 * with no credentials, fragment or variable; a header named once in any
 * letter case and never blank. And how a header's value reads: shown when
 * it only names keys, else "set".
 */

import { describe, expect, it } from "vitest";
import { agentMcpServerProblem, agentMcpServerValue, headerValueShown, type AgentMcpServerDraft } from "../agentMcpServers.js";

const OK: AgentMcpServerDraft = { name: "zendesk", url: "https://acme-co.zendesk.com/mcp", headers: [["X-Api-Key", "${ZENDESK_KEY}"]] };

function problem(change: Partial<AgentMcpServerDraft>, others: readonly string[] = []): string | null {
  return agentMcpServerProblem({ ...OK, ...change }, others);
}

describe("agentMcpServerProblem", () => {
  it("accepts a well-formed server, and http on this machine", () => {
    expect(problem({})).toBeNull();
    expect(problem({ url: "http://localhost:8787/mcp" })).toBeNull();
    expect(problem({ url: "http://127.0.0.1/mcp", headers: [] })).toBeNull();
  });

  it.each([
    ["", /Give the server a name/],
    ["Zendesk", /lowercase letters/],
    ["zendesk-", /lowercase letters/],
    ["z", /lowercase letters/],
    ["stigmer-tools", /starting with stigmer are the platform's/],
    ["plugin", /plugin names a plugin's servers/],
  ])("refuses the name %j", (name, words) => {
    expect(problem({ name })).toMatch(words);
  });

  it("refuses a name another server of the agent has", () => {
    expect(problem({}, ["linear", "zendesk"])).toMatch(/already has a server named zendesk/);
  });

  it.each([
    ["", /Give the server's URL/],
    ["https://${HOST}/mcp", /cannot name a variable/],
    ["http://zendesk.example/mcp", /must be https/],
    ["https://user:pass@zendesk.example/mcp", /must be https/],
    ["https://zendesk.example/mcp#x", /must be https/],
    ["not a url", /must be https/],
  ])("refuses the URL %j", (url, words) => {
    expect(problem({ url })).toMatch(words);
  });

  it("refuses a header named twice in any letter case, and a header with no name", () => {
    expect(problem({ headers: [["X-Key", "a"], ["x-key", "b"]] })).toMatch(/x-key is named more than once/);
    expect(problem({ headers: [["", "${KEY}"]] })).toBe("Give every header a name.");
    expect(problem({ headers: [["  ", ""]] })).toBe("Remove the empty header, or give it a name.");
  });
});

describe("headerValueShown", () => {
  it.each([
    ["${ZENDESK_KEY}", "${ZENDESK_KEY}"],
    ["Bearer ${TOKEN}", "Bearer ${TOKEN}"],
    ["${USER}:${PASSWORD}", "${USER}:${PASSWORD}"],
    ["Bearer lin_api_123", "set"],
    ["lin_api_123", "set"],
    ["key-${REGION}", "set"],
    ["application/json", "set"],
  ])("reads %j as %j", (value, shown) => {
    expect(headerValueShown(value)).toBe(shown);
  });
});

describe("agentMcpServerValue", () => {
  it("copies a stored server's headers, so an edit never writes through to it", () => {
    const stored = { name: "zendesk", url: OK.url, headers: { "X-Api-Key": "${ZENDESK_KEY}" } };
    const value = agentMcpServerValue(stored);
    expect(value).toEqual(stored);
    expect(value.headers).not.toBe(stored.headers);
  });
});
