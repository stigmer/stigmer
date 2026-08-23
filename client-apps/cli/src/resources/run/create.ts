// Resource creation for the run path: AgentExecution and WorkflowExecution.
//
// Ports the Go CLI's run_create.go. We build the full proto messages and drive
// the generated command controllers directly — the Wave-2 fidelity rule (see
// resources/apply/handlers.ts): the SDK's typed `create(input)` wrappers model a
// subset of fields, and our attachments/workspace entries are already proto
// messages, so a round-trip through the input types would be lossy and pointless.

import type { Client } from "@connectrpc/connect";
import { create, type DescService } from "@bufbuild/protobuf";
import { type AgentExecution, AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { InteractionMode, ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  AgentExecutionSpecSchema,
  type ExecutionConfig,
  ExecutionConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { type SessionSpec, SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import {
  type WorkflowExecution,
  WorkflowExecutionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { WorkflowExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { RuntimeEnv } from "./env.js";
import type { HarnessFlag, RunMode, ServiceTierFlag, ThinkingFlag } from "./prepare.js";

const API_VERSION = "agentic.stigmer.ai/v1";

// Accessor for a raw Connect client over a generated controller — the same seam
// the BackendClient exposes (client.ts) and apply uses (handlers.ts).
export type ControllerFn = <Desc extends DescService>(service: Desc) => Client<Desc>;

/**
 * Inputs for creating an agent execution. At least one of agentId/sessionId
 * must be set: agentId-only starts a new backend-managed session, sessionId
 * threads a follow-up, both pins the agent within an existing session.
 *
 * workspaceEntries ride the one-call bootstrap (spec.session_spec,
 * stigmer/stigmer#249) and shape the auto-created session; they are mutually
 * exclusive with sessionId (a session's workspace is fixed at creation).
 */
export interface CreateAgentExecutionInput {
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly orgId: string;
  readonly message: string;
  readonly runtimeEnv: RuntimeEnv;
  readonly attachments: readonly Attachment[];
  readonly workspaceFileRefs: readonly string[];
  readonly workspaceEntries: readonly WorkspaceEntry[];
  readonly model: string;
  readonly mode: RunMode;
  readonly serviceTier: ServiceTierFlag;
  readonly thinking: ThinkingFlag;
  readonly autoApproveAll: boolean;
  readonly harness: HarnessFlag;
}

/** Create an agent execution. Mirrors Go's createAgentExecution. */
export async function createAgentExecution(
  controller: ControllerFn,
  input: CreateAgentExecutionInput,
): Promise<AgentExecution> {
  const execution = create(AgentExecutionSchema, {
    apiVersion: API_VERSION,
    kind: "AgentExecution",
    metadata: create(ApiResourceMetadataSchema, { name: executionName(), org: input.orgId }),
    spec: create(AgentExecutionSpecSchema, {
      message: input.message === "" ? "execute" : input.message,
      runtimeEnv: toExecutionValues(input.runtimeEnv),
      attachments: [...input.attachments],
      workspaceFileRefs: [...input.workspaceFileRefs],
      autoApproveAll: input.autoApproveAll,
      sessionId: input.sessionId ?? "",
      agentId: input.agentId ?? "",
      // Subject is left empty: the server defaults its sentinel and the async
      // title activity replaces it, same as any auto-created session.
      sessionSpec: buildSessionSpec(input.workspaceEntries, input.harness),
      executionConfig: buildExecutionConfig(input.model, input.mode, input.serviceTier, input.thinking),
    }),
  });
  return controller(AgentExecutionCommandController).create(execution);
}

/** Inputs for creating a workflow execution. */
export interface CreateWorkflowExecutionInput {
  readonly workflowId: string;
  readonly orgId: string;
  readonly message: string;
  readonly runtimeEnv: RuntimeEnv;
}

/**
 * Create a workflow execution. Mirrors Go's createWorkflowExecution. The caller
 * either detaches (prints IDs) or streams the execution live over the canonical
 * event stream (resources/run/workflow-stream.ts).
 */
export async function createWorkflowExecution(
  controller: ControllerFn,
  input: CreateWorkflowExecutionInput,
): Promise<WorkflowExecution> {
  const execution = create(WorkflowExecutionSchema, {
    apiVersion: API_VERSION,
    kind: "WorkflowExecution",
    metadata: create(ApiResourceMetadataSchema, { name: executionName(), org: input.orgId }),
    spec: create(WorkflowExecutionSpecSchema, {
      workflowId: input.workflowId,
      triggerMessage: input.message === "" ? "execute" : input.message,
      runtimeEnv: toExecutionValues(input.runtimeEnv),
    }),
  });
  return controller(WorkflowExecutionCommandController).create(execution);
}

// Build the embedded session spec for the one-call bootstrap
// (stigmer/stigmer#249), or undefined when there is nothing to carry — the
// pre-existing wire shape for a plain run must stay byte-identical. A resolved
// harness is stamped explicitly, including "native": the value may be a
// deliberate per-run escape from the account's default_harness preference, so
// it must survive any future change to the server-side default. Empty means
// "no opinion" and stays off the wire (server defaults to native). The server
// clones this spec onto the auto-created session and then clears it from the
// persisted execution — the Session resource stays the single source of truth.
function buildSessionSpec(
  workspaceEntries: readonly WorkspaceEntry[],
  harness: HarnessFlag,
): SessionSpec | undefined {
  if (workspaceEntries.length === 0 && harness === "") return undefined;
  const spec = create(SessionSpecSchema, { workspaceEntries: [...workspaceEntries] });
  if (harness === "cursor") spec.harness = Harness.CURSOR;
  else if (harness === "native") spec.harness = Harness.NATIVE;
  return spec;
}

// Build ExecutionConfig, or undefined when no flag is set so the backend
// applies its defaults. Mirrors Go's buildExecutionConfig (only "plan" maps to a
// non-default InteractionMode; "agent"/"" leave it unspecified). An explicit
// --service-tier or --thinking value maps to the enum even for the base
// choice ("standard"/"disabled"): unspecified vs explicit is a load-bearing
// ledger distinction (#357/#772).
function buildExecutionConfig(
  model: string,
  mode: RunMode,
  serviceTier: ServiceTierFlag,
  thinking: ThinkingFlag,
): ExecutionConfig | undefined {
  if (model === "" && mode === "" && serviceTier === "" && thinking === "") return undefined;
  const cfg = create(ExecutionConfigSchema);
  if (model !== "") cfg.modelName = model;
  if (mode === "plan") cfg.interactionMode = InteractionMode.PLAN;
  if (serviceTier === "fast") cfg.serviceTier = ServiceTier.FAST;
  else if (serviceTier === "standard") cfg.serviceTier = ServiceTier.STANDARD;
  if (thinking === "enabled") cfg.thinkingMode = ThinkingMode.ENABLED;
  else if (thinking === "disabled") cfg.thinkingMode = ThinkingMode.DISABLED;
  return cfg;
}

// Convert the merged runtime env to the proto map of ExecutionValue.
function toExecutionValues(env: RuntimeEnv): Record<string, ExecutionValue> {
  const out: Record<string, ExecutionValue> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = create(ExecutionValueSchema, { value: value.value, isSecret: value.isSecret ?? false });
  }
  return out;
}

// Unique-enough placeholder name; the backend owns final identity. Mirrors Go's
// fmt.Sprintf("execution-%d", time.Now().UnixMicro()).
function executionName(): string {
  return `execution-${Date.now() * 1000}`;
}
