// The "run a resolved agent" flow (Go's executeResolvedAgent in
// run_agent_exec.go): create the agent execution (one call — a workspace rides
// the embedded session_spec and the backend bootstraps the session), then
// either detach (print header + re-attach hint) or stream and optionally
// download artifacts. Shared by `run` and `draft`.

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { BackendClient } from "../../client/index.js";
import { downloadExecutionArtifacts } from "../download.js";
import { createAgentExecution } from "./create.js";
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

  progress("Creating execution...");
  // One call: workspace entries ride the embedded session_spec
  // (stigmer/stigmer#249), so the backend bootstraps the session — resolving
  // the agent's default instance server-side (auto-creating it if missing,
  // which a client-side lookup could not) — and dispatches the message.
  const execution = await createAgentExecution(controller, {
    agentId: input.agent.metadata?.id,
    orgId: org,
    message: prepared.message,
    runtimeEnv: prepared.runtimeEnv,
    attachments: prepared.attachments,
    workspaceFileRefs: prepared.workspaceFileRefs,
    workspaceEntries: prepared.workspaceEntries,
    model: prepared.model,
    mode: prepared.mode,
    autoApproveAll: prepared.autoApproveAll,
  });

  // The backend owns the canonical session id: it creates the session and
  // records the id on the returned execution spec.
  const sessionId = execution.spec?.sessionId ?? "";

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
