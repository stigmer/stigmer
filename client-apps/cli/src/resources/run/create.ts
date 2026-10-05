// Resource creation for the run path: AgentExecution and WorkflowExecution.
//
// Ports the Go CLI's run_create.go. We build the full proto messages and drive
// the generated command controllers directly — the fidelity rule
// resources/apply/handlers.ts states: the SDK's typed `create(input)` wrappers model a
// subset of fields, and our attachments/workspace entries are already proto
// messages, so a round-trip through the input types would be lossy and pointless.

import type { Client } from "@connectrpc/connect";
import { create, type DescService } from "@bufbuild/protobuf";
import { type AgentExecution, AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { InteractionMode, ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  type AgentExecutionSpec,
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
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { RuntimeEnv } from "./env.js";
import type { HarnessFlag, RunMode, ServiceTierFlag, ThinkingFlag } from "./prepare.js";

const API_VERSION = "agentic.stigmer.ai/v1";

// Accessor for a raw Connect client over a generated controller — the same seam
// the BackendClient exposes (client.ts) and apply uses (handlers.ts).
export type ControllerFn = <Desc extends DescService>(service: Desc) => Client<Desc>;

/**
 * The agent a new conversation starts on, by reference: the server resolves
 * it, pins the version on the session it creates, and checks every later turn
 * against that pin. An empty version pins the agent's current version.
 */
export interface AgentRefInput {
  readonly org: string;
  readonly slug: string;
  readonly version?: string;
}

/**
 * Inputs for creating an agent execution. The turn's target is one of two
 * things: sessionId continues an existing conversation (whose agent the
 * session already pins), or a new conversation the backend creates from the
 * embedded session_spec. agentRef names the new conversation's agent; with
 * neither, the new conversation runs the built-in assistant.
 *
 * workspaceEntries and harness ride the one-call bootstrap (spec.session_spec,
 * stigmer/stigmer#249) and shape the auto-created session. A session's agent,
 * workspace and harness are fixed at creation, so with sessionId set they are
 * not sent: the target carries the session id alone.
 */
export interface CreateAgentExecutionInput {
  readonly agentRef?: AgentRefInput;
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
      target: buildTarget(input),
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

// The turn's target: an existing session by id, or the session_spec of the
// conversation the backend creates for it. An unset target is a new
// conversation with the built-in assistant.
function buildTarget(input: CreateAgentExecutionInput): AgentExecutionSpec["target"] {
  const sessionId = input.sessionId ?? "";
  if (sessionId !== "") return { case: "sessionId", value: sessionId };
  const sessionSpec = buildSessionSpec(input.agentRef, input.workspaceEntries, input.harness);
  if (sessionSpec === undefined) return { case: undefined };
  return { case: "sessionSpec", value: sessionSpec };
}

// Build the embedded session spec for the one-call bootstrap
// (stigmer/stigmer#249), or undefined when there is nothing to carry: a plain
// built-in-assistant run sends no session_spec at all. The agent reference
// names the conversation's agent. A resolved harness is stamped explicitly,
// including "native": the value may be a deliberate per-run escape from the
// account's default_harness preference, so it must survive any future change
// to the server-side default. Empty means "no opinion" and stays off the wire
// (server defaults to native). Subject is left empty: the server defaults its
// sentinel and the async title activity replaces it. The server clones this
// spec onto the auto-created session and then clears it from the persisted
// execution — the Session resource stays the single source of truth.
function buildSessionSpec(
  agentRef: AgentRefInput | undefined,
  workspaceEntries: readonly WorkspaceEntry[],
  harness: HarnessFlag,
): SessionSpec | undefined {
  if (agentRef === undefined && workspaceEntries.length === 0 && harness === "") return undefined;
  const spec = create(SessionSpecSchema, { workspaceEntries: [...workspaceEntries] });
  if (agentRef !== undefined) {
    spec.agentRef = create(ApiResourceReferenceSchema, {
      kind: ApiResourceKind.agent,
      org: agentRef.org,
      slug: agentRef.slug,
      version: agentRef.version ?? "",
    });
  }
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
