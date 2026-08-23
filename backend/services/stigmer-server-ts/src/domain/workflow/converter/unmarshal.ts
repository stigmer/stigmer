/**
 * Strict typed-config unmarshaling — ports
 * pkg/domain/workflow/converter/unmarshal.go. The task_config travels as an
 * opaque google.protobuf.Struct; this module turns it into the typed
 * task-config proto for the task's kind so the converter and Layer-2
 * validation get type-safe access. Strictness is the contract: unknown
 * fields are refused (protobuf-es fromJson mirrors Go protojson), which is
 * what arms the declared proto rules at stigmer#805.
 */
import type { Message } from "@bufbuild/protobuf";
import { fromJson } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";

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

/** The typed task-config schema per kind (Go unmarshal.go's switch). */
const TASK_CONFIG_SCHEMAS: Partial<Record<WorkflowTaskKind, DescMessage>> = {
  [WorkflowTaskKind.set_vars]: SetTaskConfigSchema,
  [WorkflowTaskKind.http_call]: HttpCallTaskConfigSchema,
  [WorkflowTaskKind.grpc_call]: GrpcCallTaskConfigSchema,
  [WorkflowTaskKind.switch_case]: SwitchTaskConfigSchema,
  [WorkflowTaskKind.for_each]: ForTaskConfigSchema,
  [WorkflowTaskKind.fork]: ForkTaskConfigSchema,
  [WorkflowTaskKind.try_catch]: TryTaskConfigSchema,
  [WorkflowTaskKind.listen]: ListenTaskConfigSchema,
  [WorkflowTaskKind.wait]: WaitTaskConfigSchema,
  [WorkflowTaskKind.activity_call]: CallActivityTaskConfigSchema,
  [WorkflowTaskKind.raise_error]: RaiseTaskConfigSchema,
  [WorkflowTaskKind.run_workflow]: RunTaskConfigSchema,
  [WorkflowTaskKind.agent_call]: AgentCallTaskConfigSchema,
  [WorkflowTaskKind.llm_call]: LlmCallTaskConfigSchema,
  [WorkflowTaskKind.transform]: TransformTaskConfigSchema,
  [WorkflowTaskKind.human_input]: HumanInputTaskConfigSchema,
  [WorkflowTaskKind.validate]: ValidateTaskConfigSchema,
  [WorkflowTaskKind.emit_event]: EmitEventTaskConfigSchema,
  [WorkflowTaskKind.notification]: NotificationTaskConfigSchema,
  [WorkflowTaskKind.eval]: EvalTaskConfigSchema,
};

/**
 * The typed task-config schema for a kind, or undefined for unknown kinds —
 * lets the constraints walker run protovalidate against the message it just
 * unmarshaled (Go's SharedValidator().Validate infers the type; protovalidate-es
 * takes the schema explicitly).
 */
export function taskConfigSchemaFor(
  kind: WorkflowTaskKind,
): DescMessage | undefined {
  return TASK_CONFIG_SCHEMAS[kind];
}

/**
 * Converts a task's opaque Struct config to its typed task-config proto —
 * Go's unmarshalTaskConfig (exported there as UnmarshalTaskConfigPublic for
 * the validation package; one exported form suffices here).
 *
 * Strict on unknown fields and non-canonical enum values, exactly like Go
 * protojson — an unmarshal failure is a structural spec defect the caller
 * reports (the converter as INVALID; the constraints walker skips, never
 * double-reporting).
 */
export function unmarshalTaskConfig(
  kind: WorkflowTaskKind,
  config: JsonObject | undefined,
): Message {
  if (config === undefined) {
    throw new Error("task_config cannot be nil");
  }

  const schema = TASK_CONFIG_SCHEMAS[kind];
  if (schema === undefined) {
    throw new Error(`unsupported task kind: ${WorkflowTaskKind[kind] ?? kind}`);
  }

  // The stubs surface google.protobuf.Struct fields as plain JsonObject;
  // clone before the shorthand normalization below so the caller's spec is
  // never rewritten (Go re-marshals to fresh bytes for the same reason).
  const json = structuredClone(config);
  normalizeEnumShorthands(kind, json);

  try {
    return fromJson(schema, json);
  } catch (error) {
    throw new Error(
      `failed to unmarshal JSON to proto: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * The catch-to-undefined form of unmarshalTaskConfig — for validators that
 * SKIP structurally broken configs (the conversion step already reported
 * them as INVALID; re-reporting here would double-count). Promoted on its
 * second consumer (model validation + budget warnings).
 */
export function tryUnmarshalTaskConfig<T>(
  kind: WorkflowTaskKind,
  config: JsonObject | undefined,
): T | undefined {
  try {
    return unmarshalTaskConfig(kind, config) as T;
  } catch {
    return undefined;
  }
}

/**
 * Rewrites user-friendly DSL forms to the shapes strict JSON unmarshaling
 * expects (Go normalizeEnumShorthands): harness shorthands ("cursor" →
 * "HARNESS_CURSOR"), run_config service-tier shorthands ("fast" →
 * "SERVICE_TIER_FAST"), run_config thinking-mode shorthands ("enabled" →
 * "THINKING_MODE_ENABLED"), and the environment_refs kind default (an
 * omitted kind means environment — the field can reference nothing else,
 * so requiring authors to spell it would be ceremony).
 *
 * Shorthand matching is case-insensitive on purpose: a capitalized
 * shorthand ("Fast") that fell through to strict parsing would fail loudly
 * today, but the original #357 shape silently validated one thing and
 * executed another — normalize-then-parse in ONE place is the guard.
 */
function normalizeEnumShorthands(
  kind: WorkflowTaskKind,
  json: JsonObject,
): void {
  if (kind !== WorkflowTaskKind.agent_call) {
    return;
  }

  const harness = json["harness"];
  if (typeof harness === "string") {
    switch (harness.toLowerCase()) {
      case "native":
        json["harness"] = "HARNESS_NATIVE";
        break;
      case "cursor":
        json["harness"] = "HARNESS_CURSOR";
        break;
    }
  }

  const runConfig = json["run_config"];
  if (isJsonObject(runConfig)) {
    const serviceTier = runConfig["service_tier"];
    if (typeof serviceTier === "string") {
      switch (serviceTier.toLowerCase()) {
        case "standard":
          runConfig["service_tier"] = "SERVICE_TIER_STANDARD";
          break;
        case "fast":
          runConfig["service_tier"] = "SERVICE_TIER_FAST";
          break;
      }
    }
    const thinkingMode = runConfig["thinking_mode"];
    if (typeof thinkingMode === "string") {
      switch (thinkingMode.toLowerCase()) {
        case "disabled":
          runConfig["thinking_mode"] = "THINKING_MODE_DISABLED";
          break;
        case "enabled":
          runConfig["thinking_mode"] = "THINKING_MODE_ENABLED";
          break;
      }
    }
  }

  const refs = json["environment_refs"];
  if (Array.isArray(refs)) {
    for (const ref of refs) {
      if (isJsonObject(ref) && !("kind" in ref)) {
        ref["kind"] = "environment";
      }
    }
  }
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
