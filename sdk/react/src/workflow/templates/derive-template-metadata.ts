import { parse as parseYaml } from "yaml";
import type { WorkflowTemplateMeta, WorkflowPattern } from "./types.js";

/**
 * Derive display metadata from a workflow template's YAML string.
 *
 * This is a pure function with no React or SDK dependencies — it parses
 * the YAML, walks the task list, and returns counts, kinds, and detected
 * structural patterns. Used by the gallery card and preview dialog.
 *
 * If the YAML fails to parse, returns a safe zero-value result so the
 * gallery card still renders (graceful degradation).
 */
export function deriveTemplateMeta(yaml: string): WorkflowTemplateMeta {
  try {
    const doc = parseYaml(yaml);
    const spec = doc?.spec;
    if (!spec) return EMPTY_META;

    const tasks: RawTask[] = Array.isArray(spec.tasks) ? spec.tasks : [];
    const taskKinds = new Set<string>();
    for (const task of tasks) {
      if (typeof task.kind === "string") {
        taskKinds.add(task.kind);
      }
      collectNestedKinds(task, taskKinds);
    }

    const envMap = spec.env;
    const envVarCount =
      envMap && typeof envMap === "object" ? Object.keys(envMap).length : 0;

    const hasBudget = spec.budget != null && typeof spec.budget === "object";

    const patterns = detectPatterns(tasks, taskKinds);

    return {
      taskCount: tasks.length,
      taskKinds: [...taskKinds].sort(),
      patterns,
      envVarCount,
      hasBudget,
    };
  } catch {
    return EMPTY_META;
  }
}

const EMPTY_META: WorkflowTemplateMeta = {
  taskCount: 0,
  taskKinds: [],
  patterns: [],
  envVarCount: 0,
  hasBudget: false,
};

interface RawTask {
  name?: string;
  kind?: string;
  task_config?: Record<string, unknown>;
  flow?: { then?: string };
}

/**
 * Collect task kinds from nested structures (fork branches,
 * try_catch do/catch blocks, for_each do lists).
 */
function collectNestedKinds(task: RawTask, kinds: Set<string>): void {
  const config = task.task_config;
  if (!config) return;

  // fork branches
  const branches = config.branches;
  if (Array.isArray(branches)) {
    for (const branch of branches) {
      const doTasks = branch?.do;
      if (Array.isArray(doTasks)) {
        for (const nested of doTasks) {
          if (typeof nested?.kind === "string") kinds.add(nested.kind);
          collectNestedKinds(nested as RawTask, kinds);
        }
      }
    }
  }

  // try_catch: do / catch
  const tryDo = config.do;
  if (Array.isArray(tryDo)) {
    for (const nested of tryDo) {
      if (typeof nested?.kind === "string") kinds.add(nested.kind);
      collectNestedKinds(nested as RawTask, kinds);
    }
  }
  const catchBlocks = config.catch;
  if (Array.isArray(catchBlocks)) {
    for (const block of catchBlocks) {
      const catchDo = (block as Record<string, unknown>)?.do;
      if (Array.isArray(catchDo)) {
        for (const nested of catchDo) {
          if (typeof nested?.kind === "string") kinds.add(nested.kind);
          collectNestedKinds(nested as RawTask, kinds);
        }
      }
    }
  }

  // for_each: do
  const forDo = config.do;
  if (Array.isArray(forDo) && task.kind === "for_each") {
    for (const nested of forDo) {
      if (typeof nested?.kind === "string") kinds.add(nested.kind);
      collectNestedKinds(nested as RawTask, kinds);
    }
  }
}

function detectPatterns(
  tasks: RawTask[],
  kinds: Set<string>,
): WorkflowPattern[] {
  const patterns: WorkflowPattern[] = [];

  if (kinds.has("fork")) patterns.push("parallel");
  if (kinds.has("switch_case")) patterns.push("branching");
  if (kinds.has("human_input")) patterns.push("hitl");
  if (kinds.has("for_each")) patterns.push("batch");
  if (kinds.has("try_catch")) patterns.push("error-handling");

  if (kinds.has("http_call") || kinds.has("grpc_call")) {
    patterns.push("http-integration");
  }

  const aiKinds = ["agent_call", "llm_call", "eval"];
  const aiCount = aiKinds.filter((k) => kinds.has(k)).length;
  if (aiCount >= 2 || (kinds.has("agent_call") && tasks.filter((t) => t.kind === "agent_call").length >= 2)) {
    patterns.push("ai-pipeline");
  }

  // Detect loops: any task's flow.then references an earlier task
  const taskNames = tasks.map((t) => t.name).filter(Boolean);
  for (let i = 0; i < tasks.length; i++) {
    const thenTarget = tasks[i]?.flow?.then;
    if (thenTarget && taskNames.indexOf(thenTarget) < i) {
      patterns.push("loop");
      break;
    }
  }

  return patterns;
}
