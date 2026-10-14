/**
 * Pins runServers (run-servers.ts), the one gathering of every MCP server a
 * run's turns dial: the agent's own first, then each subagent's own, then
 * each plugin's, each with its home and named as the turn names it (an
 * agent's server by its own name, a plugin's `plugin_<plugin>_<server>`).
 * A header value's keys are declared by the agent's own env when it
 * declares them, a platform variable as optional and no secret, anything
 * else left for the planner to read as a required secret. Two agents of
 * the run writing a server of one name are refused naming both; the same
 * server met twice is one.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";

import type { RunPlugin } from "../../vault/resolve.js";
import { runServers, turnServerName } from "../run-servers.js";
import type { RunAgentHome } from "../run-servers.js";
import type { RunSubagent } from "../run-subagents.js";

function writing(names: string[], env: AgentSpec["env"] = {}): AgentSpec {
  return create(AgentSpecSchema, {
    env,
    mcpServers: names.map((name) => ({ name, url: `https://${name}.example.com/mcp`, headers: { "X-Key": "${KEY}" } })),
  });
}

const AGENT: RunAgentHome = { id: "agt_main", name: "Helper", version: "v".repeat(64), spec: writing(["zendesk"]) };

function subagent(id: string, names: string[]): RunSubagent {
  return { id, name: id, org: "acme", versionHash: "s".repeat(64), spec: writing(names) };
}

const LINEAR: RunPlugin = {
  id: "plg_linear",
  name: "linear",
  status: create(PluginStatusSchema, {
    digest: "d".repeat(64),
    mcpServers: [{ name: "linear", transport: { case: "http", value: { url: "https://mcp.linear.app/mcp", headers: {} } } }],
  }),
};

function refusalOf(run: () => unknown): ConnectError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a refusal");
}

describe("runServers", () => {
  it("gathers the agent's own, each subagent's own, then each plugin's, each with its home and turn name", () => {
    const servers = runServers({ agent: AGENT, subagents: [subagent("agt_triage", ["crm"])], plugins: [LINEAR] });
    expect(servers.map((server) => [turnServerName(server), server.home])).toEqual([
      ["zendesk", { kind: "agent", agentId: "agt_main", agentName: "Helper", agentVersion: "v".repeat(64) }],
      ["crm", { kind: "agent", agentId: "agt_triage", agentName: "agt_triage", agentVersion: "s".repeat(64) }],
      ["plugin_linear_linear", { kind: "plugin", pluginId: "plg_linear", pluginName: "linear", pluginDigest: "d".repeat(64) }],
    ]);
  });

  it("declares a header's key from the agent's env, a platform variable as optional and no secret, and leaves the rest undeclared", () => {
    const spec = create(AgentSpecSchema, {
      env: { KEY: { isSecret: false, value: "fixed" }, UNUSED: { isSecret: true } },
      mcpServers: [
        {
          name: "zendesk",
          url: "https://acme-co.zendesk.com/mcp",
          headers: { "X-Key": "${KEY}", "X-Server": "${STIGMER_SERVER_ADDRESS}", "X-Other": "${OTHER}" },
        },
      ],
    });
    const [server] = runServers({ agent: { ...AGENT, spec }, subagents: [], plugins: [] });
    expect(server?.entry.env).toEqual(["KEY", "OTHER", "STIGMER_SERVER_ADDRESS"]);
    expect(Object.keys(server?.env ?? {}).sort()).toEqual(["KEY", "STIGMER_SERVER_ADDRESS"]);
    expect(server?.env["KEY"]?.value).toBe("fixed");
    expect(server?.env["STIGMER_SERVER_ADDRESS"]).toMatchObject({ isSecret: false, optional: true });
  });

  it("refuses the agent and a subagent writing a server of one name, naming both", () => {
    const error = refusalOf(() => runServers({ agent: AGENT, subagents: [subagent("agt_triage", ["zendesk"])], plugins: [] }));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      "this conversation uses two MCP servers a turn would both name 'zendesk' (agent 'Helper' server 'zendesk' and " +
        "agent 'agt_triage' server 'zendesk'); rename one of them in its agent, or remove the subagent from the agent",
    );
  });

  it("refuses two subagents writing a server of one name", () => {
    const error = refusalOf(() =>
      runServers({ agent: undefined, subagents: [subagent("agt_a", ["crm"]), subagent("agt_b", ["crm"])], plugins: [] }),
    );
    expect(error.rawMessage).toContain("would both name 'crm'");
  });

  it("gathers nothing for a run with no agent, no subagent and no plugin", () => {
    expect(runServers({ agent: undefined, subagents: [], plugins: [] })).toEqual([]);
  });
});
