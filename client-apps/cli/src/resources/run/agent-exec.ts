// The "run a resolved agent" flow (Go's executeResolvedAgent in
// run_agent_exec.go): upload what `--attach` gave, create the run (one call:
// the workspace and attached folders ride the embedded session_spec and the
// backend bootstraps the session), delete the uploaded originals the new
// conversation now holds copies of, then
// either detach (print header + re-attach hint) or stream and optionally
// download the turn's outputs, for `run`. A new conversation names its agent by
// reference (org and slug) on the embedded session_spec; the backend resolves
// it and pins the session to the agent's current version. With no agent the
// same flow runs the built-in assistant: the run names no agent, the
// backend creates a session that names none, and the header shows the
// assistant's name.

import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { BUILT_IN_ASSISTANT_NAME } from "@stigmer/client";
import type { BackendClient } from "../../client/index.js";
import { downloadRunOutputs } from "../download.js";
import { deleteFiles, stageFiles } from "./files.js";
import { type AgentRefInput, createAgentRun } from "./create.js";
import { renderSessionHeader, type SessionHeaderInfo, workspaceNames } from "./header.js";
import type { PreparedRun } from "./prepare.js";
import { streamAgentRun, type RunOutputMode } from "./stream.js";

export interface ResolvedAgentExecInput {
  /** The agent to run; undefined is the built-in assistant. */
  readonly agent: Agent | undefined;
  readonly prepared: PreparedRun;
  readonly org: string;
  /** Where the turn's outputs are downloaded; "" skips download. */
  readonly downloadDir: string;
  readonly outputMode: RunOutputMode;
  readonly client: BackendClient;
}

export async function executeResolvedAgent(input: ResolvedAgentExecInput): Promise<void> {
  const { prepared, org, client } = input;
  const controller = client.controller.bind(client);
  const progress = stderrProgress();

  // The conversation does not exist yet, so the attached files are uploaded
  // as the person's own; the run's conversation takes its own copy of each.
  const staged = await stageFiles(client.stigmer, prepared.files, { org }, progress);

  progress("Creating run...");
  // One call: the agent reference and the conversation's resources ride the
  // embedded session_spec (stigmer/stigmer#249), so the backend bootstraps
  // the session on the agent (or on no agent, for the built-in assistant)
  // and dispatches the message.
  let run: Run;
  try {
    run = await createAgentRun(controller, {
      agentRef: agentRefOf(input.agent),
      orgId: org,
      message: prepared.message,
      vaults: prepared.vaults,
      includeMyVault: prepared.includeMyVault,
      plugins: prepared.plugins,
      ...(prepared.environment === undefined ? {} : { environment: prepared.environment }),
      fileIds: staged.fileIds,
      workspaceFileRefs: prepared.files.workspaceFileRefs,
      resources: [...prepared.resources, ...staged.resources],
      model: prepared.model,
      mode: prepared.mode,
      serviceTier: prepared.serviceTier,
      thinking: prepared.thinking,
      autoApproveAll: prepared.autoApproveAll,
      harness: prepared.harness,
    });
  } finally {
    // Once the run exists its conversation holds copies; when it was never
    // created nothing names the originals. Either way they go.
    await deleteFiles(client.stigmer, staged.originals, warnStderr);
  }

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
    workspaces: workspaceNames(prepared.resources),
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
    approveDefault: prepared.approveDefault,
    outputMode: input.outputMode,
    header,
  });

  if (input.downloadDir !== "") {
    await downloadRunOutputs(
      client.stigmer,
      finalExec.metadata?.id ?? "",
      { outputPath: "", outputDir: input.downloadDir },
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

// A File left behind is worth a line even off a TTY: it is the person's own
// and stays in their account until they delete it.
function warnStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}
