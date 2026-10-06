// The "run a resolved agent" flow (Go's executeResolvedAgent in
// run_agent_exec.go): create the agent run (one call — a workspace rides
// the embedded session_spec and the backend bootstraps the session), then
// either detach (print header + re-attach hint) or stream and optionally
// download artifacts, for `run`. A new conversation names its agent by
// reference (org and slug) on the embedded session_spec; the backend resolves
// it and pins the session to the agent's current version. With no agent the
// same flow runs the built-in assistant: the run names no agent, the
// backend creates a session that names none, and the header shows the
// assistant's name.

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { BUILT_IN_ASSISTANT_NAME } from "@stigmer/sdk";
import type { BackendClient } from "../../client/index.js";
import { downloadRunArtifacts } from "../download.js";
import { type AgentRefInput, createAgentRun } from "./create.js";
import { renderSessionHeader, type SessionHeaderInfo, workspaceNames } from "./header.js";
import type { PreparedRun } from "./prepare.js";
import { streamAgentRun, type RunOutputMode } from "./stream.js";

export interface ResolvedAgentExecInput {
  /** The agent to run; undefined is the built-in assistant. */
  readonly agent: Agent | undefined;
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

  progress("Creating run...");
  // One call: the agent reference and workspace entries ride the embedded
  // session_spec (stigmer/stigmer#249), so the backend bootstraps the session
  // on the agent (or on no agent, for the built-in assistant) and dispatches
  // the message.
  const run = await createAgentRun(controller, {
    agentRef: agentRefOf(input.agent),
    orgId: org,
    message: prepared.message,
    runtimeEnv: prepared.runtimeEnv,
    attachments: prepared.attachments,
    workspaceFileRefs: prepared.workspaceFileRefs,
    workspaceEntries: prepared.workspaceEntries,
    model: prepared.model,
    mode: prepared.mode,
    serviceTier: prepared.serviceTier,
    thinking: prepared.thinking,
    autoApproveAll: prepared.autoApproveAll,
    harness: prepared.harness,
  });

  // The backend owns the canonical session id: it creates the session and
  // records the id as the returned run's target.
  const target = run.spec?.target;
  const sessionId = target?.case === "sessionId" ? target.value : "";

  const header: SessionHeaderInfo = {
    agentName: input.agent?.metadata?.name ?? BUILT_IN_ASSISTANT_NAME,
    sessionId,
    model: prepared.model,
    mode: prepared.mode,
    harness: prepared.harness,
    workspaces: workspaceNames(prepared.workspaceEntries),
  };

  if (prepared.detach) {
    renderSessionHeader(process.stderr, header);
    if (sessionId !== "") {
      process.stderr.write(`Detached (still running) — stigmer resume ${sessionId} to re-attach\n`);
    }
    return;
  }

  const finalExec = await streamAgentRun({
    client: client.stigmer,
    sessionId,
    runId: run.metadata?.id ?? "",
    org,
    mode: prepared.mode,
    defaultAction: prepared.defaultAction,
    outputMode: input.outputMode,
    header,
  });

  if (input.downloadDir !== "" && (finalExec.status?.artifacts.length ?? 0) > 0) {
    await downloadRunArtifacts(
      client.stigmer,
      finalExec.metadata?.id ?? "",
      { artifactName: "", outputDir: input.downloadDir },
      progress,
    );
  }
}

// The reference a new conversation names its agent by. The CLI takes no
// version, so the session pins the agent's current one.
function agentRefOf(agent: Agent | undefined): AgentRefInput | undefined {
  if (agent === undefined) return undefined;
  return { org: agent.metadata?.org ?? "", slug: agent.metadata?.slug ?? "" };
}

// Progress lines go to stderr, but only when it is a TTY — matching Go's spinner,
// which is suppressed under pipes/CI so it never pollutes captured output.
function stderrProgress(): (line: string) => void {
  if (process.stderr.isTTY !== true) return () => {};
  return (line) => void process.stderr.write(`${line}\n`);
}
