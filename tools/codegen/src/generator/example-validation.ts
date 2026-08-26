// Sidecar YAML-example validation against the typed proto config messages.
//
// Port of the Go generator's validateSidecarExamples: every yaml_examples
// entry must strictly decode as an authoring-form WorkflowTask whose kind
// matches the sidecar and whose task_config strictly decodes as the task's
// typed config message — the same strict protojson posture the platform
// applies when a workflow is created (fromJson rejects unknown fields by
// default, matching protojson.Unmarshal).
//
// Where Go blank-imported the compiled Go stubs to fill protoregistry, this
// port builds a registry from @stigmer/protos' generated file descriptors —
// the same registry the TS server and SDK run on.
//
// The check is deliberately at least as strict as the platform: it does not
// replicate the backend's normalizeEnumShorthands, so enum values in
// examples must use their full proto names.

import { createRegistry, fromJson } from "@bufbuild/protobuf";
import type { DescMessage, Registry } from "@bufbuild/protobuf";
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import { parse as parseYaml } from "yaml";

import { file_ai_stigmer_agentic_workflow_v1_enum, WorkflowTaskKindSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { file_ai_stigmer_agentic_workflow_v1_spec, WorkflowTaskSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_agent_call } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_call_activity } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/call_activity_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_common } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/common_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_emit_event } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/emit_event_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_eval } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/eval_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_for } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/for_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_fork } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/fork_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_grpc_call } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/grpc_call_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_http_call } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/http_call_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_human_input } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/human_input_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_listen } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/listen_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_llm_call } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/llm_call_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_notification } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/notification_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_raise } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/raise_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_run } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/run_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_set } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/set_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_switch } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/switch_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_transform } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/transform_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_try } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/try_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_validate } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/validate_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_wait } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/wait_pb";

import type { TaskConfigSchema } from "./schema.js";
import { taskKindString } from "./schema.js";
import type { SidecarMeta } from "./sidecar.js";

// Registers every per-kind task config message so configs resolve
// dynamically from TaskConfigSchema.protoType without a hand-maintained
// kind switch — the TS analogue of Go's blank stubs import.
function taskRegistry(): Registry {
  return createRegistry(
    file_ai_stigmer_agentic_workflow_v1_enum,
    file_ai_stigmer_agentic_workflow_v1_spec,
    file_ai_stigmer_agentic_workflow_v1_tasks_agent_call,
    file_ai_stigmer_agentic_workflow_v1_tasks_call_activity,
    file_ai_stigmer_agentic_workflow_v1_tasks_common,
    file_ai_stigmer_agentic_workflow_v1_tasks_emit_event,
    file_ai_stigmer_agentic_workflow_v1_tasks_eval,
    file_ai_stigmer_agentic_workflow_v1_tasks_for,
    file_ai_stigmer_agentic_workflow_v1_tasks_fork,
    file_ai_stigmer_agentic_workflow_v1_tasks_grpc_call,
    file_ai_stigmer_agentic_workflow_v1_tasks_http_call,
    file_ai_stigmer_agentic_workflow_v1_tasks_human_input,
    file_ai_stigmer_agentic_workflow_v1_tasks_listen,
    file_ai_stigmer_agentic_workflow_v1_tasks_llm_call,
    file_ai_stigmer_agentic_workflow_v1_tasks_notification,
    file_ai_stigmer_agentic_workflow_v1_tasks_raise,
    file_ai_stigmer_agentic_workflow_v1_tasks_run,
    file_ai_stigmer_agentic_workflow_v1_tasks_set,
    file_ai_stigmer_agentic_workflow_v1_tasks_switch,
    file_ai_stigmer_agentic_workflow_v1_tasks_transform,
    file_ai_stigmer_agentic_workflow_v1_tasks_try,
    file_ai_stigmer_agentic_workflow_v1_tasks_validate,
    file_ai_stigmer_agentic_workflow_v1_tasks_wait,
  );
}

/** Port of validateSidecarExamples — throws with all problems on failure. */
export function validateSidecarExamples(
  schemas: TaskConfigSchema[],
  sidecars: Map<string, SidecarMeta>,
): void {
  const registry = taskRegistry();
  const problems: string[] = [];

  for (const schema of schemas) {
    const kind = taskKindString(schema);
    const meta = sidecars.get(kind);
    if (meta === undefined || meta.yamlExamples.length === 0) continue;

    const configDesc = registry.getMessage(schema.protoType);
    if (configDesc === undefined) {
      problems.push(
        `${kind}: cannot resolve proto message "${schema.protoType}" (is the stubs package imported?)`,
      );
      continue;
    }

    for (let i = 0; i < meta.yamlExamples.length; i++) {
      const problem = validateTaskExample(meta.yamlExamples[i], kind, configDesc);
      if (problem !== null) {
        problems.push(`${kind} example ${i + 1}: ${problem}`);
      }
    }
  }

  if (problems.length === 0) return;

  throw new Error(
    `task sidecar example validation failed (${problems.length} problem(s)):\n  - ${problems.join("\n  - ")}\n\n` +
      "yaml_examples must use the authoring form users write under spec.tasks:\n" +
      "  - name: <task_name>\n" +
      "    kind: <kind>\n" +
      "    task_config:\n" +
      "      <task_config fields>\n" +
      "not the internal DSL form (- taskName: { call/set/wait: ... }) that the\n" +
      "platform generates for the runner.\n" +
      "Fix the example in apis/ai/stigmer/agentic/workflow/v1/tasks/meta/<kind>.yaml",
  );
}

// Returns a problem description, or null when the example is valid.
function validateTaskExample(
  exampleYaml: string,
  expectedKind: string,
  configDesc: DescMessage,
): string | null {
  let entries: unknown;
  try {
    entries = parseYaml(exampleYaml);
  } catch (err) {
    return `not a YAML list of task entries: ${errText(err)}`;
  }
  if (!Array.isArray(entries)) {
    return "not a YAML list of task entries";
  }
  if (entries.length === 0) {
    return "example contains no task entries";
  }

  for (let i = 0; i < entries.length; i++) {
    const problem = validateTaskEntry(entries[i] as JsonObject, expectedKind, configDesc);
    if (problem !== null) {
      return entries.length === 1 ? problem : `task entry ${i + 1}: ${problem}`;
    }
  }
  return null;
}

function validateTaskEntry(
  entry: JsonObject,
  expectedKind: string,
  configDesc: DescMessage,
): string | null {
  // Stage 1: the entry itself must be an authoring-form task. The internal
  // DSL form ({ taskName: { call: ..., with: ... } }) fails here because
  // its single map key is not a WorkflowTask field.
  let task;
  try {
    task = fromJson(WorkflowTaskSchema, entry as JsonValue);
  } catch (err) {
    return `does not parse as an authoring-form task (name/kind/task_config): ${errText(err)}`;
  }
  if (task.name === "") {
    return "task name is required";
  }
  const kindName =
    WorkflowTaskKindSchema.values.find((v: { number: number; name: string }) => v.number === task.kind)?.name ??
    String(task.kind);
  if (kindName !== expectedKind) {
    return `kind is "${kindName}", want "${expectedKind}"`;
  }
  if (task.taskConfig === undefined) {
    return "task_config is required";
  }

  // Stage 2: task_config is a Struct at the WorkflowTask level (so stage 1
  // accepts any shape inside it); decode it into the typed config message
  // with default strictness, exactly as the platform does. protobuf-es
  // surfaces Struct fields as plain JsonObject, so no re-marshal is needed.
  try {
    fromJson(configDesc, task.taskConfig);
  } catch (err) {
    return `task_config is not a valid ${configDesc.typeName}: ${errText(err)}`;
  }
  return null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
