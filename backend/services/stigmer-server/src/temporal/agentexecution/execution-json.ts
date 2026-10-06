/**
 * Decodes the run JSON that crosses Temporal, tolerating names the current
 * contract no longer knows.
 *
 * A local activity's result is recorded in Temporal history and replayed
 * from it, and an activity's input is recorded when the workflow schedules
 * it, so a run in flight across a deploy is decoded from JSON an older
 * server or runner wrote. Two kinds of old name reach these decoders:
 *
 * * - Retired names. The rename of executions to runs (October 2026)
 *   changed field JSON names (`executionId` became `runId`), enum value
 *   names (`EXECUTION_COMPLETED` became `RUN_COMPLETED`) and the kind
 *   string (`AgentExecution` became `AgentRun`) without moving a field or
 *   value number. The tables below map each old name to its new one, for
 *   the messages that cross Temporal: AgentRun, AgentRunStatus and
 *   WorkflowRunStatus with everything nested in them. They were computed
 *   from that rename by pairing the old and new descriptor sets element by
 *   element, never typed by hand. A rewrite is guided by the schema, so a
 *   name is only rewritten where the old contract had it: a free-form
 *   string or a Struct value is never touched. The tables go once no
 *   history recorded before that release can still run, the way
 *   deprecatePatch ends a patched branch.
 * - Reserved names. When a release reserves a field or an enum value
 *   (approval_policy_source's per-tool policy values, for one), the JSON
 *   still carries it. The workflow's load of its run is a read of the
 *   record, never a write, so it drops an unknown name: the enum reads as
 *   its zero value, exactly as a stored row decodes. A status update is a
 *   write, and stays strict.
 *
 * Bundle-safe: imported by the workflow.
 */
import {
  fromJson,
  type DescEnum,
  type DescField,
  type DescMessage,
  type JsonObject,
  type JsonValue,
  type MessageShape,
} from "@bufbuild/protobuf";
import {
  AgentRunSchema,
  type AgentRun,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";

const RETIRED_FIELD_NAMES: ReadonlyMap<string, string> = new Map([
  ["childAgentExecutionId", "childAgentRunId"],
  ["child_agent_execution_id", "child_agent_run_id"],
  ["executionId", "runId"],
  ["execution_id", "run_id"],
  ["subAgentExecutions", "subAgentRuns"],
  ["sub_agent_executions", "sub_agent_runs"],
  ["supersedesExecutionId", "supersedesRunId"],
  ["supersedes_execution_id", "supersedes_run_id"],
  ["workflowExecutionId", "workflowRunId"],
  ["workflow_execution_id", "workflow_run_id"],
]);

const RETIRED_ENUM_VALUE_NAMES: ReadonlyMap<string, string> = new Map([
  ["EXECUTION_ARTIFACT_KIND_DIRECTORY", "RUN_ARTIFACT_KIND_DIRECTORY"],
  ["EXECUTION_ARTIFACT_KIND_FILE", "RUN_ARTIFACT_KIND_FILE"],
  ["EXECUTION_ARTIFACT_KIND_UNSPECIFIED", "RUN_ARTIFACT_KIND_UNSPECIFIED"],
  ["EXECUTION_CANCELLED", "RUN_CANCELLED"],
  ["EXECUTION_COMPLETED", "RUN_COMPLETED"],
  ["EXECUTION_FAILED", "RUN_FAILED"],
  ["EXECUTION_IN_PROGRESS", "RUN_IN_PROGRESS"],
  ["EXECUTION_PAUSED", "RUN_PAUSED"],
  ["EXECUTION_PENDING", "RUN_PENDING"],
  ["EXECUTION_PHASE_UNSPECIFIED", "RUN_PHASE_UNSPECIFIED"],
  ["EXECUTION_TERMINATED", "RUN_TERMINATED"],
  ["EXECUTION_WAITING_FOR_APPROVAL", "RUN_WAITING_FOR_APPROVAL"],
  ["agent_execution", "agent_run"],
  ["mid_execution", "mid_run"],
  ["workflow_execution", "workflow_run"],
]);

/** The kind strings a run's `kind` field carried before the rename. */
const RETIRED_KIND_NAMES: ReadonlyMap<string, string> = new Map([
  ["AgentExecution", "AgentRun"],
  ["WorkflowExecution", "WorkflowRun"],
]);

function retiredEnumValue(value: JsonValue, desc: DescEnum): JsonValue {
  if (typeof value !== "string" || desc.values.some((v) => v.name === value)) {
    return value;
  }
  const renamed = RETIRED_ENUM_VALUE_NAMES.get(value);
  return renamed !== undefined && desc.values.some((v) => v.name === renamed)
    ? renamed
    : value;
}

function retiredMessage(value: JsonValue, desc: DescMessage): JsonValue {
  if (!isJsonObject(value) || desc.typeName.startsWith("google.protobuf.")) {
    return value;
  }
  const out: JsonObject = {};
  for (const [key, raw] of Object.entries(value)) {
    let field = desc.fields.find((f) => f.jsonName === key || f.name === key);
    let name = key;
    if (field === undefined) {
      const renamed = RETIRED_FIELD_NAMES.get(key);
      field =
        renamed === undefined
          ? undefined
          : desc.fields.find((f) => f.jsonName === renamed || f.name === renamed);
      if (field !== undefined) {
        name = field.jsonName;
      }
    }
    out[name] = field === undefined || raw === undefined ? raw : retiredField(raw, field);
  }
  if (typeof out.kind === "string") {
    out.kind = RETIRED_KIND_NAMES.get(out.kind) ?? out.kind;
  }
  return out;
}

/** One field's value, or each element of a list or map field. */
function retiredField(raw: JsonValue, field: DescField): JsonValue {
  if (field.fieldKind === "list" && Array.isArray(raw)) {
    return raw.map((item) => retiredElement(item, field));
  }
  if (field.fieldKind === "map" && isJsonObject(raw)) {
    return Object.fromEntries(
      Object.entries(raw).map(([key, item]) => [key, retiredElement(item, field)]),
    );
  }
  return retiredElement(raw, field);
}

/** A singular value of a field: an enum name or a message is renamed, a scalar kept. */
function retiredElement(raw: JsonValue, field: DescField): JsonValue {
  if (field.enum !== undefined) {
    return retiredEnumValue(raw, field.enum);
  }
  if (field.message !== undefined) {
    return retiredMessage(raw, field.message);
  }
  return raw;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The current name of an enum value name a run's JSON may still carry: a
 * retired name maps to its successor, any other name is returned as given.
 * For readers that look a phase up by name outside a schema-guided decode
 * (the runner activity's result, an untyped record).
 */
export function currentRunEnumValueName(name: string): string {
  return RETIRED_ENUM_VALUE_NAMES.get(name) ?? name;
}

/** Rewrites every retired name in run JSON to its current name, guided by the schema. */
export function renameRetiredRunJson(desc: DescMessage, raw: JsonValue): JsonValue {
  return retiredMessage(raw, desc);
}

/** The workflow's load of its run: retired names renamed, reserved names dropped. */
export function decodeLoadedExecution(raw: JsonValue): AgentRun {
  return fromJson(AgentRunSchema, renameRetiredRunJson(AgentRunSchema, raw), {
    ignoreUnknownFields: true,
  });
}

/** A status update's payload: retired names renamed, anything else unknown refused. */
export function decodeRunStatusJson<Desc extends DescMessage>(
  schema: Desc,
  raw: JsonValue,
): MessageShape<Desc> {
  return fromJson(schema, renameRetiredRunJson(schema, raw));
}
