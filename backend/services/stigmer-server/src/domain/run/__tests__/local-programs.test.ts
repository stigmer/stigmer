/**
 * Pins the local-program rule (local-programs.ts): a plugin's stdio MCP
 * server runs only where a person's own runner runs it.
 *
 * The deployment's policy refuses only when all three hold: the sandbox
 * lane is enabled, its provisioner's runner runs in cloud mode, and the
 * conversation's target resolves to CLOUD (UNSPECIFIED through the
 * configured default). A disabled lane, a provisioner in local mode or
 * one that states no mode (open source's), and a LOCAL target all keep
 * local programs.
 *
 * The refusal is FAILED_PRECONDITION naming the plugin and the server, for
 * the first plugin that carries a stdio entry; a plugin whose servers are
 * all URLs passes, and no policy (a deployment that wires none) refuses
 * nothing.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { PluginStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import type { SandboxLane } from "../../../sandbox/lane.js";
import type { SandboxProvisioner } from "../../../sandbox/provisioner.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import type { RunPlugin } from "../../vault/resolve.js";
import { newLocalProgramPolicy, refuseLocalPrograms } from "../local-programs.js";
import type { LocalProgramPolicy } from "../local-programs.js";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_CLOUD,
} from "../temporal/config.js";

function unused(): never {
  throw new Error("the local-program rule never drives the sandbox");
}

function provisioner(runnerMode: "local" | "cloud" | undefined): SandboxProvisioner {
  return {
    ...(runnerMode === undefined ? {} : { runnerMode }),
    ensureSessionSandbox: async () => unused(),
    deprovisionSessionSandbox: async () => unused(),
    createConnectSandbox: async () => unused(),
    deprovisionConnectSandbox: async () => unused(),
    probe: async () => unused(),
  };
}

const credentials: RunnerCredentialProvider = {
  isEnabled: () => unused(),
  mint: () => unused(),
  verify: () => unused(),
};

function lane(runnerMode: "local" | "cloud" | undefined): SandboxLane {
  return { enabled: true, provisioner: provisioner(runnerMode), credentials };
}

/** A config whose UNSPECIFIED target resolves to CLOUD. */
const cloudDefault = new AgentExecutionTemporalConfig(
  "agent_execution_stigmer",
  "stigmer_runner",
  "global",
  DEFAULT_EXECUTION_TARGET_CLOUD,
);
/** A config whose UNSPECIFIED target resolves to LOCAL. */
const localDefault = new AgentExecutionTemporalConfig(
  "agent_execution_stigmer",
  "stigmer_runner",
  "global",
  "local",
);

function plugin(name: string, servers: { name: string; stdio: boolean }[]): RunPlugin {
  return {
    id: `plg_${name}`,
    name,
    status: create(PluginStatusSchema, {
      mcpServers: servers.map((server) => ({
        name: server.name,
        transport: server.stdio
          ? { case: "stdio" as const, value: { command: "npx", args: ["server"] } }
          : { case: "http" as const, value: { url: `https://${server.name}.example/mcp` } },
      })),
    }),
  };
}

describe("the deployment's policy", () => {
  it("refuses a CLOUD target on an enabled lane whose runner runs in cloud mode, an UNSPECIFIED one included when the default is CLOUD", () => {
    const policy = newLocalProgramPolicy(lane("cloud"), cloudDefault);
    expect(policy.refusesLocalPrograms(ExecutionTarget.CLOUD)).toBe(true);
    expect(policy.refusesLocalPrograms(ExecutionTarget.UNSPECIFIED)).toBe(true);
    expect(policy.refusesLocalPrograms(ExecutionTarget.LOCAL)).toBe(false);
  });

  it("keeps an UNSPECIFIED target that resolves to LOCAL", () => {
    const policy = newLocalProgramPolicy(lane("cloud"), localDefault);
    expect(policy.refusesLocalPrograms(ExecutionTarget.UNSPECIFIED)).toBe(false);
    expect(policy.refusesLocalPrograms(ExecutionTarget.CLOUD)).toBe(true);
  });

  it("keeps local programs on a lane whose runner runs in local mode or states no mode, and on a disabled lane", () => {
    for (const [what, sandboxLane] of [
      ["local mode", lane("local")],
      ["no mode stated", lane(undefined)],
      ["no lane", { enabled: false } satisfies SandboxLane],
    ] as const) {
      const policy = newLocalProgramPolicy(sandboxLane, cloudDefault);
      expect(policy.refusesLocalPrograms(ExecutionTarget.CLOUD), what).toBe(false);
    }
  });
});

describe("refuseLocalPrograms", () => {
  const refusing: LocalProgramPolicy = { refusesLocalPrograms: () => true };
  const keeping: LocalProgramPolicy = { refusesLocalPrograms: () => false };

  it("refuses the first plugin that runs a server as a local program, naming the plugin and the server", () => {
    let failure: unknown;
    try {
      refuseLocalPrograms(refusing, ExecutionTarget.CLOUD, [
        plugin("linear", [{ name: "linear", stdio: false }]),
        plugin("files", [
          { name: "remote", stdio: false },
          { name: "disk", stdio: true },
        ]),
      ]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((failure as ConnectError).rawMessage).toContain("plugin 'files'");
    expect((failure as ConnectError).rawMessage).toContain("MCP server 'disk'");
    expect((failure as ConnectError).rawMessage).toContain("desktop app or the CLI");
  });

  it("passes plugins whose servers are all URLs", () => {
    expect(() =>
      refuseLocalPrograms(refusing, ExecutionTarget.CLOUD, [
        plugin("linear", [{ name: "linear", stdio: false }]),
        plugin("skills-only", []),
      ]),
    ).not.toThrow();
  });

  it("refuses nothing when the policy keeps the target, or when no policy is wired", () => {
    const local = [plugin("files", [{ name: "disk", stdio: true }])];
    expect(() => refuseLocalPrograms(keeping, ExecutionTarget.CLOUD, local)).not.toThrow();
    expect(() => refuseLocalPrograms(undefined, ExecutionTarget.CLOUD, local)).not.toThrow();
  });

  it("asks the policy about the conversation's own target", () => {
    const asked: ExecutionTarget[] = [];
    refuseLocalPrograms(
      {
        refusesLocalPrograms: (target) => {
          asked.push(target);
          return false;
        },
      },
      ExecutionTarget.LOCAL,
      [],
    );
    expect(asked).toEqual([ExecutionTarget.LOCAL]);
  });
});
