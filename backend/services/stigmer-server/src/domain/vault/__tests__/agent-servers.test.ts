/**
 * Pins agentServerEntry (agent-servers.ts): a server written in an agent
 * reads as an HTTP plugin server entry with its own URL and headers, its
 * `env` the names its header values read (each once, sorted, by the
 * runner's own `${NAME}` scanner), and no sign-in record. A header with no
 * reference adds nothing, and the entry is a copy: changing it leaves the
 * agent's server as it was.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentMcpServerSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";

import { agentServerEntry } from "../agent-servers.js";

describe("agentServerEntry", () => {
  it("reads as an HTTP server entry naming every run value its headers read", () => {
    const server = create(AgentMcpServerSchema, {
      name: "zendesk",
      url: "https://acme-co.zendesk.com/mcp",
      headers: { "X-Api-Key": "${ZENDESK_KEY}", "X-Both": "${B}-${ZENDESK_KEY}", "X-Trace": "on" },
    });
    const entry = agentServerEntry(server);
    expect(entry.name).toBe("zendesk");
    expect(entry.env).toEqual(["B", "ZENDESK_KEY"]);
    expect(entry.signIn).toBeUndefined();
    expect(entry.transport.case).toBe("http");
    if (entry.transport.case !== "http") return;
    expect(entry.transport.value.url).toBe("https://acme-co.zendesk.com/mcp");
    expect(entry.transport.value.headers).toEqual(server.headers);
    entry.transport.value.headers["X-Trace"] = "off";
    expect(server.headers["X-Trace"]).toBe("on");
  });
});
