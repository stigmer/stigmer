// The "run a resolved agent" flow (Go's executeResolvedAgent in
// run_agent_exec.go): create the workspace session if needed, create the agent
// execution, then either detach (print header + re-attach hint) or stream and
// optionally download artifacts. Shared by `run` and `draft`.

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { BackendClient } from "../../client/index.js";
import { CliExitError, ExitCode } from "../../errors/index.js";
import { downloadExecutionArtifacts } from "../download.js";
import { createAgentExecution, createSessionForAgent } from "./create.js";
import { renderSessionHeader, type SessionHeaderInfo, workspaceNames } from "./header.js";
import type { PreparedRun } from "./prepare.js";
import { streamAgentExecution, type RunOutputMode } from "./stream.js";

export interface ResolvedAgentExecInput {
  readonly agent: Agent;
  readonly prepared: PreparedRun;
  readonly org: string;
  /** Artifact download directory; "" skips download. */
  readonly downloadDir: string;
  readonly outputMode: RunOutputMode;
  readonly client: BackendClient;
}

export async function executeResolvedAgent(input: ResolvedAgentExecInput): Promise<void> {
  const { prepared, org, client } = input;
  const controller = client.controller.bind(client);
  const progress = stderrProgress();

  // Workspaces require a CLI-created session: the backend's auto-create flow has
  // no workspace passthrough (Go's createSessionForAgent).
  let sessionId = "";
  if (prepared.workspaceEntries.length > 0) {
    const instanceId = input.agent.status?.defaultInstanceId ?? "";
    if (instanceId === "") {
      throw new CliExitError("agent has no default instance — cannot create workspace session", ExitCode.General);
    }
    progress("Creating workspace...");
    const session = await createSessionForAgent(controller, {
      agentInstanceId: instanceId,
      orgId: org,
      workspaceEntries: prepared.workspaceEntries,
    });
    sessionId = session.metadata?.id ?? "";
  }

  progress("Creating execution...");
  const execution = await createAgentExecution(controller, {
    agentId: input.agent.metadata?.id,
    sessionId: sessionId === "" ? undefined : sessionId,
    orgId: org,
    message: prepared.message,
    runtimeEnv: prepared.runtimeEnv,
    attachments: prepared.attachments,
    workspaceFileRefs: prepared.workspaceFileRefs,
    model: prepared.model,
    mode: prepared.mode,
    autoApproveAll: prepared.autoApproveAll,
  });

  // The backend owns the canonical session id; prefer it over the CLI-created
  // one (they agree, but the spec value is authoritative).
  sessionId = execution.spec?.sessionId ?? sessionId;

  const header: SessionHeaderInfo = {
    agentName: input.agent.metadata?.name ?? "",
    sessionId,
    model: prepared.model,
    mode: prepared.mode,
    workspaces: workspaceNames(prepared.workspaceEntries),
  };

  if (prepared.detach) {
    renderSessionHeader(process.stderr, header);
    if (sessionId !== "") {
      process.stderr.write(`Detached (still running) — stigmer resume ${sessionId} to re-attach\n`);
    }
    return;
  }

  const finalExec = await streamAgentExecution({
    client: client.stigmer,
    sessionId,
    executionId: execution.metadata?.id ?? "",
    org,
    mode: prepared.mode,
    defaultAction: prepared.defaultAction,
    outputMode: input.outputMode,
    header,
  });

  if (input.downloadDir !== "" && (finalExec.status?.artifacts.length ?? 0) > 0) {
    await downloadExecutionArtifacts(
      client.stigmer,
      finalExec.metadata?.id ?? "",
      { artifactName: "", outputDir: input.downloadDir },
      progress,
    );
  }
}

// Progress lines go to stderr, but only when it is a TTY — matching Go's spinner,
// which is suppressed under pipes/CI so it never pollutes captured output.
function stderrProgress(): (line: string) => void {
  if (process.stderr.isTTY !== true) return () => {};
  return (line) => void process.stderr.write(`${line}\n`);
}
