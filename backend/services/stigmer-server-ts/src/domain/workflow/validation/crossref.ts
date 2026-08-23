/**
 * Task-kind and cross-task-reference validation — ports
 * pkg/domain/workflow/validation/crossref.go: recognized task kinds, unique
 * task names, flow.then / fallback_task / cases[].then / outcomes[].then
 * reference resolution with did-you-mean suggestions, cycle detection, and
 * the surface rules the task-config protos cannot declare. Reference checks
 * read the raw task_config Struct (not the typed config) so the errors
 * speak the author's own vocabulary. Keep every string in lockstep with the
 * cloud Java validator.
 */
import { enumToJson } from "@bufbuild/protobuf";
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";

import { WorkflowTaskKind, WorkflowTaskKindSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type {
  WorkflowSpec,
  WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

/**
 * Checks that every task has a recognized, non-zero WorkflowTaskKind —
 * errors for unspecified (0) or unknown enum values (Go ValidateTaskKinds).
 */
export function validateTaskKinds(spec: WorkflowSpec | undefined): string[] {
  if (spec === undefined || spec.tasks.length === 0) {
    return [];
  }
  const errors: string[] = [];
  for (const task of spec.tasks) {
    if (WorkflowTaskKind[task.kind] === undefined || task.kind === 0) {
      errors.push(
        `task '${task.name}': unknown or unspecified task kind (value=${task.kind})`,
      );
    }
  }
  return errors;
}

/**
 * Checks that all task-name references point to tasks that exist (Go
 * ValidateCrossTaskReferences): llm_call/validate fallback_task,
 * agent_call output.fallback_task, switch_case cases[].then, human_input
 * outcomes[].then, and flow.then on every task. Also validates unique task
 * names and detects cycles.
 */
export function validateCrossTaskReferences(
  spec: WorkflowSpec | undefined,
): string[] {
  if (spec === undefined || spec.tasks.length === 0) {
    return [];
  }

  const errors: string[] = [];
  const taskNames = buildTaskNameSet(spec.tasks);

  errors.push(...validateUniqueTaskNames(spec.tasks));
  errors.push(...validateFlowReferences(spec.tasks, taskNames));

  for (const task of spec.tasks) {
    if (task.taskConfig === undefined) {
      continue;
    }
    errors.push(
      ...extractAndValidateRefs(task.name, task.kind, task.taskConfig, taskNames),
    );
  }

  errors.push(...validateNoCycles(spec.tasks, taskNames));

  return errors;
}

function buildTaskNameSet(tasks: WorkflowTask[]): Set<string> {
  const names = new Set<string>();
  for (const t of tasks) {
    if (t.name !== "") {
      names.add(t.name);
    }
  }
  return names;
}

function validateUniqueTaskNames(tasks: WorkflowTask[]): string[] {
  const seen = new Map<string, number>();
  const errors: string[] = [];

  tasks.forEach((task, i) => {
    if (task.name === "") {
      return;
    }
    const firstIdx = seen.get(task.name);
    if (firstIdx !== undefined) {
      errors.push(
        `duplicate task name "${task.name}" at tasks[${i}]: already defined at tasks[${firstIdx}]`,
      );
    }
    seen.set(task.name, i);
  });

  return errors;
}

function validateFlowReferences(
  tasks: WorkflowTask[],
  taskNames: Set<string>,
): string[] {
  const errors: string[] = [];

  for (const task of tasks) {
    if (task.flow === undefined || task.flow.then === "") {
      continue;
    }
    const then = task.flow.then;
    if (then === "end") {
      continue;
    }
    if (!taskNames.has(then)) {
      const suggestion = suggestSimilar(then, taskNames);
      let msg = `task '${task.name}' flow.then references unknown task '${then}'`;
      if (suggestion !== "") {
        msg += ` (did you mean '${suggestion}'?)`;
      }
      errors.push(msg);
    }
  }

  return errors;
}

/**
 * Cycle detection over the flow.then graph. Go iterates its task-name map
 * in random order, so a multi-node cycle's reported rotation varies per
 * run there; iterating in insertion order here is deterministic and always
 * one of the rotations Go could emit.
 */
function validateNoCycles(
  tasks: WorkflowTask[],
  taskNames: Set<string>,
): string[] {
  const graph = new Map<string, string>();
  for (const task of tasks) {
    if (task.flow === undefined || task.flow.then === "") {
      continue;
    }
    graph.set(task.name, task.flow.then);
  }

  const visited = new Set<string>();
  const path = new Set<string>();
  const pathOrder: string[] = [];
  const errors: string[] = [];

  const dfs = (node: string): void => {
    if (path.has(node)) {
      const startIdx = pathOrder.indexOf(node);
      const cycleParts = [...pathOrder.slice(startIdx), node];
      errors.push(`circular dependency detected: ${cycleParts.join(" -> ")}`);
      return;
    }
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    path.add(node);
    pathOrder.push(node);

    const next = graph.get(node);
    if (next !== undefined && next !== "end" && taskNames.has(next)) {
      dfs(next);
    }

    path.delete(node);
    pathOrder.pop();
  };

  for (const name of taskNames) {
    if (!visited.has(name)) {
      dfs(name);
    }
  }

  return errors;
}

function extractAndValidateRefs(
  taskName: string,
  kind: WorkflowTaskKind,
  config: JsonObject,
  validNames: Set<string>,
): string[] {
  const errors: string[] = [];
  const fields = config;

  switch (kind) {
    case WorkflowTaskKind.llm_call:
    case WorkflowTaskKind.validate: {
      const ref = getStringField(fields, "fallbackTask", "fallback_task");
      if (ref !== "" && !validNames.has(ref)) {
        const suggestion = suggestSimilar(ref, validNames);
        let msg = `task '${taskName}' (${enumToJson(WorkflowTaskKindSchema, kind)}) fallback_task references unknown task '${ref}'`;
        if (suggestion !== "") {
          msg += ` (did you mean '${suggestion}'?)`;
        }
        errors.push(msg);
      }
      break;
    }

    case WorkflowTaskKind.agent_call: {
      const output = getStructField(fields, "output");
      if (output !== undefined) {
        const ref = getStringField(output, "fallbackTask", "fallback_task");
        if (ref !== "" && !validNames.has(ref)) {
          const suggestion = suggestSimilar(ref, validNames);
          let msg = `task '${taskName}' (agent_call) output.fallback_task references unknown task '${ref}'`;
          if (suggestion !== "") {
            msg += ` (did you mean '${suggestion}'?)`;
          }
          errors.push(msg);
        }
      }
      break;
    }

    case WorkflowTaskKind.switch_case: {
      getListField(fields, "cases").forEach((c, i) => {
        const caseStruct = structValueOf(c);
        if (caseStruct === undefined) {
          return;
        }
        const ref = getStringField(caseStruct, "then");
        if (ref !== "" && ref !== "end" && !validNames.has(ref)) {
          const suggestion = suggestSimilar(ref, validNames);
          let msg = `task '${taskName}' (switch_case) cases[${i}].then references unknown task '${ref}'`;
          if (suggestion !== "") {
            msg += ` (did you mean '${suggestion}'?)`;
          }
          errors.push(msg);
        }
      });
      break;
    }

    case WorkflowTaskKind.human_input: {
      getListField(fields, "outcomes").forEach((o, i) => {
        const outcomeStruct = structValueOf(o);
        if (outcomeStruct === undefined) {
          return;
        }
        const ref = getStringField(outcomeStruct, "then");
        if (ref !== "" && ref !== "end" && !validNames.has(ref)) {
          const suggestion = suggestSimilar(ref, validNames);
          let msg = `task '${taskName}' (human_input) outcomes[${i}].then references unknown task '${ref}'`;
          if (suggestion !== "") {
            msg += ` (did you mean '${suggestion}'?)`;
          }
          errors.push(msg);
        }
      });
      break;
    }
  }

  return errors;
}

/**
 * Checks the task-config semantics the config protos cannot declare (Go
 * ValidateTaskConfigSurfaceRules). Since stigmer#805 armed the declared
 * rules over strict-unmarshaled typed configs, what remains is genuinely
 * contextual:
 *
 *   - agent_call workspace_entries must use git_repo sources:
 *     WorkspaceSource's oneof legitimately offers local_path on the session
 *     surface, but no client is connected to serve one when a workflow task
 *     fires — a workflow-surface restriction, not a schema fact, so it
 *     cannot live on the shared proto. (Source presence and git_repo.url's
 *     HTTPS shape ARE schema facts enforced via the constraints step.)
 *
 * Keep the strings in lockstep with the cloud Java validator.
 */
export function validateTaskConfigSurfaceRules(
  spec: WorkflowSpec | undefined,
): string[] {
  if (spec === undefined || spec.tasks.length === 0) {
    return [];
  }

  const errors: string[] = [];
  for (const task of spec.tasks) {
    if (task.kind !== WorkflowTaskKind.agent_call || task.taskConfig === undefined) {
      continue;
    }
    getListField(task.taskConfig, "workspace_entries").forEach((v, i) => {
      const entry = structValueOf(v);
      if (entry === undefined) {
        return;
      }
      const source = getStructField(entry, "source");
      if (source === undefined) {
        // Absence is the constraints step's required-rule to report.
        return;
      }
      if (getStructField(source, "git_repo") === undefined) {
        errors.push(
          `task '${task.name}' (agent_call): workspace_entries[${i}] must use a git_repo source — no client is connected to serve a local_path when a workflow task fires`,
        );
      }
    });
  }
  return errors;
}

/**
 * The first non-empty string among the given keys (Go getStringField): a
 * present key with a non-string or empty value falls through to the next.
 * The stubs surface Struct fields as plain JsonObject, so the readers here
 * work over plain JSON — the same shapes Go's structpb getters resolve.
 */
function getStringField(fields: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    const v = fields[key];
    if (typeof v === "string" && v !== "") {
      return v;
    }
  }
  return "";
}

/**
 * The struct value of the FIRST present key (Go getStructField returns on
 * the first hit even when it is not a struct — mirrored).
 */
function getStructField(
  fields: JsonObject,
  ...keys: string[]
): JsonObject | undefined {
  for (const key of keys) {
    const v = fields[key];
    if (v !== undefined) {
      return structValueOf(v);
    }
  }
  return undefined;
}

function getListField(fields: JsonObject, key: string): JsonValue[] {
  const v = fields[key];
  return Array.isArray(v) ? v : [];
}

function structValueOf(v: JsonValue): JsonObject | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? v
    : undefined;
}

/**
 * The single closest task name within edit distance 3, or "" (Go
 * suggestSimilar): candidates are scanned in sorted order and a strictly
 * smaller distance wins, so ties resolve to the lexicographically first.
 */
function suggestSimilar(target: string, names: Set<string>): string {
  const maxDistance = 3;
  let bestName = "";
  let bestDist = maxDistance + 1;

  for (const name of [...names].sort()) {
    const d = levenshtein(target.toLowerCase(), name.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      bestName = name;
    }
  }

  return bestDist <= maxDistance ? bestName : "";
}

/**
 * Two-row Levenshtein distance (Go levenshtein). Byte vs UTF-16 code-unit
 * comparison is equivalent for the ASCII task names the validator sees.
 */
function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) {
    return lb;
  }
  if (lb === 0) {
    return la;
  }

  let prev: number[] = new Array<number>(lb + 1);
  let curr: number[] = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[lb]!;
}
