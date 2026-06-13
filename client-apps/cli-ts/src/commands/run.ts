// `stigmer run [agent-ref | <type> <reference>]` — execute an agent (or create a
// workflow execution) and stream it. Thin handler: parse flags, resolve the
// reference (smart 0/1/2-arg dispatch mirroring Go's run.go + run_picker.go),
// then delegate to the shared run stack. Heavy modules (backend client, Ink,
// the differ) load lazily inside the action so `--help` stays fast (DD-001).

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { addAgentExecFlags, type AgentExecOptions } from "./agent-exec-flags.js";
import { globalOrg } from "./shared.js";

interface RunFlags extends AgentExecOptions {
  json?: boolean;
  download?: string;
}

export function registerRun(program: Command): void {
  const run = program
    .command("run [type] [reference]")
    .description("execute an agent or workflow by reference");
  addAgentExecFlags(run)
    .option("--json", "stream events as newline-delimited JSON")
    .option("--download <dir>", "download artifacts to directory when complete")
    .action((type: string | undefined, reference: string | undefined, options: RunFlags, command: Command) =>
      runRun(type, reference, options, command),
    );
}

async function runRun(
  type: string | undefined,
  reference: string | undefined,
  options: RunFlags,
  command: Command,
): Promise<void> {
  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  if (org === "") {
    throw new UsageError(
      "organization not set\n\n" +
        "Set it with one of:\n" +
        "  stigmer config context set --org <org>\n" +
        "  stigmer run --org <org> ...",
    );
  }

  const outputMode = options.json === true ? "json" : "inline";

  // 0 args → interactive browse (picker is a separate, not-yet-wired task).
  if (type === undefined) {
    throw browseUnavailableError("");
  }
  // 1 arg → smart resolution; 2 args → explicit "<type> <reference>".
  if (reference === undefined) {
    await runSmart(type, options, org, outputMode, client);
    return;
  }
  await runExplicit(type, reference, options, org, outputMode, client);
}

// stigmer run <value>: classify the single argument and dispatch (Go's
// executeRunSmart). Session IDs belong to `resume`; complete agent IDs resolve
// directly; other resource IDs require the explicit two-arg form; bare text is
// resolved as an agent slug.
async function runSmart(
  value: string,
  options: RunFlags,
  org: string,
  outputMode: "inline" | "json",
  client: import("../client/index.js").BackendClient,
): Promise<void> {
  const { isSessionId, hasResourceIdPrefix, isAgentId, validateResourceId } = await import("../resources/reference.js");

  if (isSessionId(value)) {
    throw new UsageError(
      `Session IDs are handled by the resume command\n\nTo resume a session:\n  stigmer resume ${value}`,
    );
  }

  if (hasResourceIdPrefix(value)) {
    if (isAgentId(value)) {
      if (validateResourceId(value) !== null) {
        throw new UsageError(
          `Incomplete agent ID: ${value}\n\nProvide the full agent ID (e.g. agt_01abc123xyz456789012345678)`,
        );
      }
      await runAgent(value, options, org, outputMode, client);
      return;
    }
    throw new UsageError(
      `Cannot run resource ID "${value}" directly with the short form\n\nUse the explicit form:\n  stigmer run <type> <id>`,
    );
  }

  // Bare text: try to resolve as an agent reference; on failure, guide the user
  // (interactive picker fallback is a separate task).
  const { resolveAgentRef } = await import("../resources/run/resolve.js");
  let agent: import("@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb").Agent;
  try {
    agent = await resolveAgentRef(client.stigmer, value, org);
  } catch {
    throw browseUnavailableError(value);
  }
  await runResolvedAgent(agent, options, org, outputMode, client);
}

// stigmer run <type> <reference>: explicit form (Go's executeRun + routeRun).
async function runExplicit(
  type: string,
  reference: string,
  options: RunFlags,
  org: string,
  outputMode: "inline" | "json",
  client: import("../client/index.js").BackendClient,
): Promise<void> {
  const { defaultRegistry, Verb } = await import("../registry/index.js");
  const { ApiResourceKind } = await import(
    "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb"
  );

  const info = defaultRegistry().getByAlias(type);
  if (info === undefined) {
    throw new UsageError(`unknown resource type: ${type}\n\nAvailable types: agent, workflow`);
  }
  if (!info.supportedVerbs.has(Verb.Run)) {
    throw new UsageError(`${info.displayName} does not support 'run'`);
  }

  if (info.kind === ApiResourceKind.workflow) {
    await runWorkflow(reference, options, org, outputMode, client);
    return;
  }
  const { resolveAgentRef } = await import("../resources/run/resolve.js");
  const agent = await resolveAgentRef(client.stigmer, reference, org);
  await runResolvedAgent(agent, options, org, outputMode, client);
}

// Resolve a complete agent ID, then run.
async function runAgent(
  agentId: string,
  options: RunFlags,
  org: string,
  outputMode: "inline" | "json",
  client: import("../client/index.js").BackendClient,
): Promise<void> {
  const { resolveAgentRef } = await import("../resources/run/resolve.js");
  const agent = await resolveAgentRef(client.stigmer, agentId, org);
  await runResolvedAgent(agent, options, org, outputMode, client);
}

async function runResolvedAgent(
  agent: import("@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb").Agent,
  options: RunFlags,
  org: string,
  outputMode: "inline" | "json",
  client: import("../client/index.js").BackendClient,
): Promise<void> {
  const { prepareAgentExec } = await import("../resources/run/prepare.js");
  const { executeResolvedAgent } = await import("../resources/run/agent-exec.js");
  const { toAgentExecFlags } = await import("./agent-exec-flags.js");

  const prepared = await prepareAgentExec(toAgentExecFlags(options), client.stigmer, org, stderrProgress());
  await executeResolvedAgent({
    agent,
    prepared,
    org,
    downloadDir: options.download ?? "",
    outputMode,
    client,
  });
}

// Workflow path: create the execution, then either detach (print IDs + return,
// Go parity) or stream it live over the canonical event stream. Mirrors Go's
// routeRun workflow branch's guards. `--json` now produces a real NDJSON event
// stream (fix for D-WF-1: Go silently ignored run workflow --json).
async function runWorkflow(
  reference: string,
  options: RunFlags,
  org: string,
  outputMode: "inline" | "json",
  client: import("../client/index.js").BackendClient,
): Promise<void> {
  if (options.workspace.length > 0) {
    throw new UsageError("--workspace is not supported for workflows (workspace is an agent-level concept)");
  }
  const [{ resolveWorkflowRef }, { createWorkflowExecution }, { loadAndMergeEnv }, { parseApprovalAction }] =
    await Promise.all([
      import("../resources/run/resolve.js"),
      import("../resources/run/create.js"),
      import("../resources/run/env.js"),
      import("../resources/run/prepare.js"),
    ]);

  const workflow = await resolveWorkflowRef(client.stigmer, reference, org);
  const runtimeEnv = loadAndMergeEnv({
    envFlags: options.env,
    secretFlags: options.secret,
    envFiles: options.envFile,
    secretFiles: options.secretFile,
  });
  if (runtimeEnv.STIGMER_ORG_ID === undefined && org !== "") {
    runtimeEnv.STIGMER_ORG_ID = { value: org, isSecret: false };
  }

  const execution = await createWorkflowExecution(client.controller.bind(client), {
    workflowId: workflow.metadata?.id ?? "",
    orgId: org,
    message: options.message ?? "",
    runtimeEnv,
  });
  const id = execution.metadata?.id ?? "";

  if (options.detach === true) {
    process.stdout.write(`Workflow execution created: ${id}\n`);
    process.stdout.write(`Track it with: stigmer execution logs ${id} --follow\n`);
    return;
  }

  const { ApprovalAction } = await import("@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb");
  const { streamWorkflowExecution } = await import("../resources/run/workflow-stream.js");
  await streamWorkflowExecution({
    client: client.stigmer,
    executionId: id,
    outputMode,
    defaultAction: options.autoApprove === true ? ApprovalAction.APPROVE_ALL : parseApprovalAction(options.approveDefault ?? ""),
  });
}

function stderrProgress(): (line: string) => void {
  if (process.stderr.isTTY !== true) return () => {};
  return (line) => void process.stderr.write(`${line}\n`);
}

// Until the interactive picker lands (separate task), 0-arg and unresolved
// references produce actionable guidance instead of a browse UI.
function browseUnavailableError(query: string): UsageError {
  const head =
    query === ""
      ? "Interactive agent browsing is not available yet"
      : `No agent found for "${query}"`;
  return new UsageError(
    `${head}\n\n` +
      "Specify a full agent reference:\n" +
      "  stigmer run <org/slug>\n" +
      "  stigmer run <agent-id>",
  );
}
