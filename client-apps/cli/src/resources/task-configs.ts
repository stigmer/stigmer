// Typed decode of workflow task_config blocks — the offline twin of the
// server's `unmarshalTaskConfig` (backend/services/stigmer-server/pkg/domain/
// workflow/converter/unmarshal.go).
//
// The Workflow proto models `task_config` as an open google.protobuf.Struct
// discriminated by `kind`, so the top-level schema decode accepts ANY config
// payload; a real apply then decodes it into the kind's typed message and
// rejects what does not fit. Before this module, `stigmer validate` and
// `apply --dry-run` reported "valid" for configs a real apply refuses
// (stigmer/stigmer#778).
//
// Scope is decode-truth only: field shapes, types, enum membership, unknown
// fields. Semantic validation (cross-task references, expression namespaces,
// model registry, protovalidate required-field rules) remains the server's
// authority via `validateSpec`.

import { type DescMessage, fromJson, type JsonValue } from "@bufbuild/protobuf";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { AgentCallTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import { CallActivityTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/call_activity_pb";
import { EmitEventTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/emit_event_pb";
import { EvalTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/eval_pb";
import { ForTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/for_pb";
import { ForkTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/fork_pb";
import { GrpcCallTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/grpc_call_pb";
import { HttpCallTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/http_call_pb";
import { HumanInputTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/human_input_pb";
import { ListenTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/listen_pb";
import { LlmCallTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/llm_call_pb";
import { NotificationTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/notification_pb";
import { RaiseTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/raise_pb";
import { RunTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/run_pb";
import { SetTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/set_pb";
import { SwitchTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/switch_pb";
import { TransformTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/transform_pb";
import { TryTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/try_pb";
import { ValidateTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/validate_pb";
import { WaitTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/wait_pb";

// Exported for the drift test (task-configs.test.ts), which holds this map and
// the WorkflowTaskKind enum descriptor to strict bidirectional equality — the
// stigmer/stigmer#353 drift class: a new task kind cannot ship without a CLI
// schema binding, and a retired kind cannot linger here. The entries mirror
// the server's `unmarshalTaskConfig` kind switch one-for-one.
export const TASK_CONFIG_SCHEMAS: ReadonlyMap<WorkflowTaskKind, DescMessage> = new Map<
  WorkflowTaskKind,
  DescMessage
>([
  [WorkflowTaskKind.set_vars, SetTaskConfigSchema],
  [WorkflowTaskKind.http_call, HttpCallTaskConfigSchema],
  [WorkflowTaskKind.grpc_call, GrpcCallTaskConfigSchema],
  [WorkflowTaskKind.switch_case, SwitchTaskConfigSchema],
  [WorkflowTaskKind.for_each, ForTaskConfigSchema],
  [WorkflowTaskKind.fork, ForkTaskConfigSchema],
  [WorkflowTaskKind.try_catch, TryTaskConfigSchema],
  [WorkflowTaskKind.listen, ListenTaskConfigSchema],
  [WorkflowTaskKind.wait, WaitTaskConfigSchema],
  [WorkflowTaskKind.activity_call, CallActivityTaskConfigSchema],
  [WorkflowTaskKind.raise_error, RaiseTaskConfigSchema],
  [WorkflowTaskKind.run_workflow, RunTaskConfigSchema],
  [WorkflowTaskKind.agent_call, AgentCallTaskConfigSchema],
  [WorkflowTaskKind.llm_call, LlmCallTaskConfigSchema],
  [WorkflowTaskKind.transform, TransformTaskConfigSchema],
  [WorkflowTaskKind.human_input, HumanInputTaskConfigSchema],
  [WorkflowTaskKind.validate, ValidateTaskConfigSchema],
  [WorkflowTaskKind.emit_event, EmitEventTaskConfigSchema],
  [WorkflowTaskKind.notification, NotificationTaskConfigSchema],
  [WorkflowTaskKind.eval, EvalTaskConfigSchema],
]);

/**
 * Decodes every task's `task_config` into its kind's typed proto message,
 * throwing on the first config a real apply would reject. Runs on the decoded
 * Workflow message (after the top-level schema decode), so snake_case and
 * json-name spellings are already normalized.
 *
 * A task with no `task_config` is skipped: its absence is a protovalidate
 * required-field violation, which is the server's layer, not decode-truth.
 */
export function decodeWorkflowTaskConfigs(workflow: Workflow): void {
  for (const task of workflow.spec?.tasks ?? []) {
    if (task.taskConfig === undefined) continue;
    const schema = TASK_CONFIG_SCHEMAS.get(task.kind);
    if (schema === undefined) continue; // unspecified/unknown kind — the server's layer reports it

    // protobuf-es represents google.protobuf.Struct fields as plain JSON, so
    // the Struct's content feeds the per-kind decode directly.
    const config = normalizeTaskConfigShorthands(task.kind, task.taskConfig);
    try {
      fromJson(schema, config, { ignoreUnknownFields: false });
    } catch (err) {
      throw new Error(
        `task '${task.name}' (${WorkflowTaskKind[task.kind]}): invalid task_config: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Rewrites user-friendly DSL forms to the shapes the proto decode expects —
 * the twin of the server's `normalizeEnumShorthands` (unmarshal.go): agent_call
 * harness shorthands ("cursor" → "HARNESS_CURSOR"), run_config service-tier
 * shorthands ("fast" → "SERVICE_TIER_FAST"), and the environment_refs kind
 * default (an omitted kind means environment). Without this twin the offline
 * decode would be STRICTER than a real apply and fail valid manifests.
 */
function normalizeTaskConfigShorthands(kind: WorkflowTaskKind, config: JsonValue): JsonValue {
  if (kind !== WorkflowTaskKind.agent_call || !isJsonObject(config)) {
    return config;
  }

  const normalized: Record<string, JsonValue> = { ...config };

  if (typeof normalized.harness === "string") {
    const harness = HARNESS_SHORTHANDS[normalized.harness.toLowerCase()];
    if (harness !== undefined) normalized.harness = harness;
  }

  if (isJsonObject(normalized.run_config)) {
    const runConfig: Record<string, JsonValue> = { ...normalized.run_config };
    if (typeof runConfig.service_tier === "string") {
      const tier = SERVICE_TIER_SHORTHANDS[runConfig.service_tier.toLowerCase()];
      if (tier !== undefined) runConfig.service_tier = tier;
    }
    normalized.run_config = runConfig;
  }

  if (Array.isArray(normalized.environment_refs)) {
    normalized.environment_refs = normalized.environment_refs.map((ref) =>
      isJsonObject(ref) && ref.kind === undefined ? { ...ref, kind: "environment" } : ref,
    );
  }

  return normalized;
}

const HARNESS_SHORTHANDS: Record<string, string> = {
  native: "HARNESS_NATIVE",
  cursor: "HARNESS_CURSOR",
};

const SERVICE_TIER_SHORTHANDS: Record<string, string> = {
  standard: "SERVICE_TIER_STANDARD",
  fast: "SERVICE_TIER_FAST",
};

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
