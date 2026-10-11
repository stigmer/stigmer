/**
 * A plugin's local program (a stdio MCP server) runs only where a person's
 * own runner runs it: the desktop app or the CLI. A conversation whose turns
 * run in a hosted sandbox, whose runner refuses to start a local program
 * (the runner's transport guard, in cloud mode), is refused when it is made
 * and again when a turn is created, naming the plugin and the server, so a
 * person learns it before a turn fails on it rather than at its first tool
 * call.
 *
 * What decides it is one statement the runner also reads: the sandbox
 * provisioner's runner mode (`SandboxProvisioner.runnerMode`), which the
 * provisioner writes into every sandbox it starts. A conversation that runs
 * on a local target, a deployment with no sandbox lane, or a lane whose
 * runner runs in local mode, keeps its local programs.
 *
 * Tests: __tests__/local-programs.test.ts.
 */
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import { failedPreconditionError } from "../../pipeline/errors.js";
import type { SandboxLane } from "../../sandbox/lane.js";
import type { RunPlugin } from "../vault/resolve.js";
import type { AgentExecutionTemporalConfig } from "./temporal/config.js";

/** Whether a conversation's turns would run where a local program cannot start. */
export interface LocalProgramPolicy {
  refusesLocalPrograms(target: ExecutionTarget): boolean;
}

/** The deployment's policy: a cloud target served by a sandbox whose runner runs in cloud mode. */
export function newLocalProgramPolicy(
  lane: SandboxLane,
  temporalConfig: Pick<AgentExecutionTemporalConfig, "resolveExecutionTarget">,
): LocalProgramPolicy {
  return {
    refusesLocalPrograms(target) {
      return (
        lane.enabled &&
        lane.provisioner.runnerMode === "cloud" &&
        temporalConfig.resolveExecutionTarget(target) === ExecutionTarget.CLOUD
      );
    },
  };
}

/** Refuses when a listed plugin carries a local program and the conversation runs where none can start. */
export function refuseLocalPrograms(
  policy: LocalProgramPolicy | undefined,
  target: ExecutionTarget,
  plugins: readonly RunPlugin[],
): void {
  if (policy === undefined || !policy.refusesLocalPrograms(target)) {
    return;
  }
  for (const plugin of plugins) {
    const server = plugin.status.mcpServers.find((entry) => entry.transport.case === "stdio");
    if (server !== undefined) {
      throw failedPreconditionError(
        `plugin '${plugin.name}' runs its MCP server '${server.name}' as a local program, which runs only in the desktop app or the CLI; ` +
          "start this conversation there, or remove the plugin from it",
      );
    }
  }
}
