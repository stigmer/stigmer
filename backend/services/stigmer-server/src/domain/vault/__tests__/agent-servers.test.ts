/**
 * Pins agentServerEntry (agent-servers.ts): a server written in an agent
 * reads as an HTTP plugin server entry with its own URL and headers, its
 * `env` the names its header values read (each once, sorted, by the
 * runner's own `${NAME}` scanner), and no sign-in record of its own. A
 * header with no reference adds nothing, and the entry is a copy: changing
 * it leaves the agent's server as it was.
 *
 * With the answers the agent's save recorded (AgentStatus.server_sign_ins),
 * a server whose answer at its own address asked for a sign-in is
 * completed as a plugin's install completes one: `sign_in.oauth_only`, the
 * `Authorization: Bearer ${<SERVER>_ACCESS_TOKEN}` header, the variable in
 * `env`. An answer recorded at another address, an answer with no sign-in,
 * and a server that speaks about authentication itself are read as written.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentMcpServerSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentServerSignInSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import { McpServerSignInSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";

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

describe("agentServerEntry with the save's answers", () => {
  const server = create(AgentMcpServerSchema, { name: "app-tools", url: "https://tools.acme.test/mcp", headers: { "X-Trace": "on" } });
  const answer = (url: string, signIn: boolean) =>
    create(AgentServerSignInSchema, {
      name: "app-tools",
      url,
      ...(signIn ? { signIn: create(McpServerSignInSchema, { oauthOnly: true }) } : {}),
    });

  it("completes a server whose answer at its address asked for a sign-in", () => {
    const entry = agentServerEntry(server, [answer("https://tools.acme.test/mcp", true)]);
    expect(entry.signIn?.oauthOnly).toBe(true);
    expect(entry.env).toEqual(["APP_TOOLS_ACCESS_TOKEN"]);
    expect(entry.transport.case === "http" ? entry.transport.value.headers : {}).toEqual({
      "X-Trace": "on",
      Authorization: "Bearer ${APP_TOOLS_ACCESS_TOKEN}",
    });
    expect(server.headers).toEqual({ "X-Trace": "on" });
  });

  it.each([
    ["an answer recorded at another address", server, [answer("https://old.acme.test/mcp", true)]],
    ["an answer with no sign-in", server, [answer("https://tools.acme.test/mcp", false)]],
    [
      "a server that sends its own Authorization",
      create(AgentMcpServerSchema, { name: "app-tools", url: "https://tools.acme.test/mcp", headers: { Authorization: "Bearer ${APP_KEY}" } }),
      [answer("https://tools.acme.test/mcp", true)],
    ],
  ])("reads %s as written", (_label, written, answers) => {
    const entry = agentServerEntry(written, answers);
    expect(entry.signIn).toBeUndefined();
    expect(entry.transport.case === "http" ? entry.transport.value.headers : {}).toEqual(written.headers);
  });
});
