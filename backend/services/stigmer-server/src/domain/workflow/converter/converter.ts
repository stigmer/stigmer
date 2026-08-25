/**
 * WorkflowSpec → CNCF Serverless Workflow DSL converter — ports
 * pkg/domain/workflow/converter/converter.go. The Stigmer proto uses a
 * "kind + Struct" pattern where each task has a WorkflowTaskKind enum and a
 * google.protobuf.Struct task_config; this module transforms that into the
 * CNCF Serverless Workflow DSL 1.0.0 format (document/do with task-type
 * keywords like set:, call:, ...) that the TS workflow engine (the runner's
 * loader.ts) parses and executes.
 *
 * CANONICAL RENDERING (sub-project DD-B): the emitted YAML is the input to
 * the version hash (SHA-256 over the string — version_steps), so rendering
 * must be a pure function of the spec: identical specs produce identical
 * bytes regardless of wire key order (the #341 no-phantom-version rule,
 * pinned by the conformance permutation test). Go gets canonical key order
 * free from yaml.v3's sorted map marshaling; protobuf-es preserves JSON
 * insertion order, so this edition sorts explicitly via js-yaml's sortKeys
 * (the same library the runner parses with). Byte-equality with Go's
 * emitter is deliberately NOT a goal — no wire contract pins it, and the
 * disclosed consequence is one re-versioning per workflow on the first
 * post-cutover re-apply of an unchanged spec on an adopted Go database.
 */
import yaml from "js-yaml";

import type {
  WorkflowDocument,
  WorkflowSpec,
  WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import { convertTaskByKind } from "./task-converters.js";
import type { YamlMap } from "./task-converters.js";
import { unmarshalTaskConfig } from "./unmarshal.js";

export { unmarshalTaskConfig } from "./unmarshal.js";

/**
 * Converts a WorkflowSpec proto to the CNCF Serverless Workflow DSL YAML
 * string — Go's Converter.ProtoToYAML.
 */
export function protoToYaml(spec: WorkflowSpec | undefined): string {
  if (spec === undefined) {
    throw new Error("workflow spec cannot be nil");
  }
  if (spec.document === undefined) {
    throw new Error("workflow document cannot be nil");
  }
  if (spec.tasks.length === 0) {
    throw new Error("workflow must have at least one task");
  }

  // The top-level loop adds the "failed to convert task ..." wrap (Go
  // ProtoToYAML); nested task lists convert without it (Go convertTaskList).
  const doTasks = spec.tasks.map((task) => {
    try {
      return convertTask(task);
    } catch (error) {
      throw new Error(
        `failed to convert task '${task.name}': ${errorMessage(error)}`,
      );
    }
  });

  const workflow: YamlMap = {
    document: buildDocument(spec.document),
    do: doTasks,
  };

  // sortKeys makes the rendering canonical (DD-B above); lineWidth -1
  // disables folding so long expressions and prompts stay single-line
  // scalars; noRefs keeps repeated structures inline (Go never emits
  // anchors); js-yaml appends a trailing newline like yaml.v3.
  return yaml.dump(workflow, { sortKeys: true, lineWidth: -1, noRefs: true });
}

function buildDocument(doc: WorkflowDocument): YamlMap {
  const result: YamlMap = {
    dsl: doc.dsl,
    namespace: doc.namespace,
    name: doc.name,
    version: doc.version,
  };

  if (doc.description !== "") {
    result["description"] = doc.description;
  }

  return result;
}

/**
 * Converts a WorkflowTask to its CNCF DSL entry — a single-key map
 * { taskName: taskDefinition } (Go convertTask).
 */
function convertTask(task: WorkflowTask): YamlMap {
  if (task.name === "") {
    throw new Error("task name is required");
  }

  let taskConfig;
  try {
    taskConfig = unmarshalTaskConfig(task.kind, task.taskConfig);
  } catch (error) {
    throw new Error(
      `failed to unmarshal task '${task.name}' config: ${errorMessage(error)}`,
    );
  }

  let taskDef: YamlMap;
  try {
    taskDef = convertTaskByKind(task.kind, taskConfig, convertTaskList);
  } catch (error) {
    throw new Error(`task '${task.name}': ${errorMessage(error)}`);
  }

  if (task.export !== undefined && task.export.as !== "") {
    taskDef["export"] = { as: task.export.as };
  }

  if (task.flow !== undefined && task.flow.then !== "") {
    taskDef["then"] = task.flow.then;
  }

  if (task.compensate.length > 0) {
    const compTasks = wrapCompensateError(task.name, () =>
      convertTaskList(task.compensate),
    );
    const metadata = (taskDef["metadata"] as YamlMap | undefined) ?? {};
    metadata["__stigmer_compensate"] = compTasks;
    taskDef["metadata"] = metadata;
  }

  return { [task.name]: taskDef };
}

function convertTaskList(tasks: WorkflowTask[]): YamlMap[] {
  return tasks.map((task) => convertTask(task));
}

function wrapCompensateError<T>(taskName: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new Error(`task '${taskName}' compensate: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
