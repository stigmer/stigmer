/**
 * Pins agentServerEntry (agent-servers.ts): a server an agent writes reads
 * as an HTTP entry with its own URL and headers and the run values those
 * headers name; it takes `Authorization: Bearer ${<NAME>_ACCESS_TOKEN}`
 * only when the run's values for it hold that login, so a server with none
 * is called with no login instead of refused for an unresolved header; and
 * a server whose headers name Authorization themselves keeps its own.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentMcpServerSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";

import { agentServerEntry } from "../agent-servers.js";

const ZENDESK = create(AgentMcpServerSchema, {
  name: "zendesk",
  url: "https://acme-co.zendesk.com/mcp",
  headers: { "X-Api-Key": "${ZENDESK_KEY}" },
});

function headersOf(entry: ReturnType<typeof agentServerEntry>): Record<string, string> {
  return entry.transport.case === "http" ? { ...entry.transport.value.headers } : {};
}

describe("agentServerEntry", () => {
  it("reads as an HTTP entry naming the run values its headers read", () => {
    const entry = agentServerEntry(ZENDESK, undefined);
    expect(entry.name).toBe("zendesk");
    expect(entry.transport.case === "http" ? entry.transport.value.url : "").toBe("https://acme-co.zendesk.com/mcp");
    expect(headersOf(entry)).toEqual({ "X-Api-Key": "${ZENDESK_KEY}" });
    expect(entry.env).toEqual(["ZENDESK_KEY"]);
  });

  it("adds the login header only when the run's values hold the login", () => {
    expect(headersOf(agentServerEntry(ZENDESK, { ZENDESK_KEY: "k" }))).toEqual({ "X-Api-Key": "${ZENDESK_KEY}" });
    const signedIn = agentServerEntry(ZENDESK, { ZENDESK_KEY: "k", ZENDESK_ACCESS_TOKEN: "t" });
    expect(headersOf(signedIn)).toEqual({ "X-Api-Key": "${ZENDESK_KEY}", Authorization: "Bearer ${ZENDESK_ACCESS_TOKEN}" });
    expect(signedIn.env).toEqual(["ZENDESK_ACCESS_TOKEN", "ZENDESK_KEY"]);
  });

  it("keeps a server's own Authorization header, whatever the values hold", () => {
    const own = create(AgentMcpServerSchema, {
      name: "zendesk",
      url: "https://acme-co.zendesk.com/mcp",
      headers: { authorization: "Bearer ${ZD_TOKEN}" },
    });
    expect(headersOf(agentServerEntry(own, { ZD_TOKEN: "a", ZENDESK_ACCESS_TOKEN: "t" }))).toEqual({ authorization: "Bearer ${ZD_TOKEN}" });
  });

  it("leaves the agent's server as written", () => {
    agentServerEntry(ZENDESK, { ZENDESK_ACCESS_TOKEN: "t" });
    expect({ ...ZENDESK.headers }).toEqual({ "X-Api-Key": "${ZENDESK_KEY}" });
  });
});
