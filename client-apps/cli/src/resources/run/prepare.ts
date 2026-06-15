// The agent-execution prelude: validate flags and resolve every input the
// create step needs. Ports the Go CLI's prepareAgentExec (run_agent_exec.go).
//
// Order matters and mirrors Go: validate cheap flags first (mode, approve
// default), then parse workspaces, then merge env, then process attachments
// (the only step that hits the network). A failure short-circuits before any
// upload. STIGMER_ORG_ID is injected into the runtime env when absent so agents
// can address the caller's org without the user wiring it manually.

import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/index.js";
import { type ProgressSink, processAttachments } from "./attachments.js";
import { loadAndMergeEnv, type RuntimeEnv } from "./env.js";
import { localWorkspaceRoots, parseWorkspaceEntries } from "./workspace.js";

/** The interaction mode requested for the run; "" means the agent default. */
export type RunMode = "" | "agent" | "plan";

/** Raw agent-execution flags shared by `run` and `draft` (Go's agentExecFlags). */
export interface AgentExecFlags {
  readonly message: string;
  readonly attach: readonly string[];
  readonly approveDefault: string;
  readonly verbose: boolean;
  readonly detach: boolean;
  readonly workspace: readonly string[];
  readonly branch: string;
  readonly commit: string;
  readonly env: readonly string[];
  readonly envFile: readonly string[];
  readonly secret: readonly string[];
  readonly secretFile: readonly string[];
  readonly model: string;
  readonly autoApprove: boolean;
  readonly mode: RunMode;
}

/**
 * The validated, resolved inputs ready for create + stream. Mirrors Go's
 * preparedAgentExec, minus the client/org which the command already owns.
 */
export interface PreparedRun {
  readonly defaultAction: ApprovalAction;
  readonly workspaceEntries: WorkspaceEntry[];
  readonly runtimeEnv: RuntimeEnv;
  readonly attachments: Attachment[];
  readonly workspaceFileRefs: string[];
  readonly message: string;
  readonly detach: boolean;
  readonly verbose: boolean;
  readonly model: string;
  readonly autoApproveAll: boolean;
  readonly mode: RunMode;
}

/**
 * Validate flags and resolve all execution inputs. The `org` is used to inject
 * STIGMER_ORG_ID and the `client` to upload non-workspace attachments.
 */
export async function prepareAgentExec(
  flags: AgentExecFlags,
  client: Stigmer,
  org: string,
  progress?: ProgressSink,
): Promise<PreparedRun> {
  const defaultAction = parseApprovalAction(flags.approveDefault);
  validateMode(flags.mode);

  const workspaceEntries = parseWorkspaceEntries(flags.workspace, flags.branch, flags.commit);

  const runtimeEnv = loadAndMergeEnv({
    envFlags: flags.env,
    secretFlags: flags.secret,
    envFiles: flags.envFile,
    secretFiles: flags.secretFile,
  });
  if (runtimeEnv.STIGMER_ORG_ID === undefined && org !== "") {
    runtimeEnv.STIGMER_ORG_ID = { value: org, isSecret: false };
  }

  const { attachments, workspaceFileRefs } = await processAttachments(
    client.agentExecution,
    flags.attach,
    localWorkspaceRoots(workspaceEntries),
    progress,
  );

  return {
    defaultAction,
    workspaceEntries,
    runtimeEnv,
    attachments,
    workspaceFileRefs,
    message: flags.message,
    detach: flags.detach,
    verbose: flags.verbose,
    model: flags.model,
    autoApproveAll: flags.autoApprove,
    mode: flags.mode,
  };
}

/**
 * Parse the `--approve-default` flag to an ApprovalAction. Empty means "no
 * default" (UNSPECIFIED). Mirrors Go's approval.ParseAction, including the
 * approve-all aliases and case-insensitivity.
 */
export function parseApprovalAction(value: string): ApprovalAction {
  if (value.trim() === "") return ApprovalAction.UNSPECIFIED;
  switch (value.trim().toLowerCase()) {
    case "approve":
      return ApprovalAction.APPROVE;
    case "skip":
      return ApprovalAction.SKIP;
    case "reject":
      return ApprovalAction.REJECT;
    case "approve-all":
    case "approve_all":
    case "approveall":
      return ApprovalAction.APPROVE_ALL;
    default:
      throw new UsageError(
        `invalid --approve-default value "${value}": must be one of: approve, skip, reject, approve-all`,
      );
  }
}

/**
 * Validate the `--mode` flag. Empty (unset) is valid and means "use default"
 * (agent). Mirrors Go's validateMode.
 */
export function validateMode(mode: string): asserts mode is RunMode {
  if (mode !== "" && mode !== "agent" && mode !== "plan") {
    throw new UsageError(`invalid --mode value "${mode}": must be "agent" or "plan"`);
  }
}
