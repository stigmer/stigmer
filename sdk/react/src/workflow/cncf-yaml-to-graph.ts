import { parse as parseYaml } from "yaml";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type {
  WorkflowGraphModel,
  WorkflowGraphNode,
  WorkflowGraphEdge,
  WorkflowGraphDocument,
} from "./workflow-graph-model.js";
import { START_NODE_ID, END_NODE_ID } from "./workflow-graph-model.js";
import { categorizeKind } from "./kind-metadata.js";
import { stringToTaskKind } from "./workflow-graph-conversions.js";

// ---------------------------------------------------------------------------
// CNCF call type -> Stigmer kind string mapping
//
// The Go converter (backend/services/stigmer-server/pkg/domain/workflow/converter/)
// uses shortened call types in the CNCF YAML (e.g., "agent" not "agent_call").
// This map translates them back to Stigmer WorkflowTaskKind enum names.
// ---------------------------------------------------------------------------

const CNCF_CALL_TO_KIND_STRING: ReadonlyMap<string, string> = new Map([
  ["agent", "agent_call"],
  ["http", "http_call"],
  ["grpc", "grpc_call"],
  ["llm", "llm_call"],
  ["transform", "transform"],
  ["human_input", "human_input"],
  ["validate", "validate"],
  ["emit_event", "emit_event"],
  ["notification", "notification"],
  ["eval", "eval"],
]);

function cncfCallToKindString(callType: string): string {
  return CNCF_CALL_TO_KIND_STRING.get(callType) ?? callType;
}

// ---------------------------------------------------------------------------
// CNCF Serverless Workflow DSL -> WorkflowGraphModel
// ---------------------------------------------------------------------------

/**
 * Parses a CNCF Serverless Workflow DSL 1.0.0 YAML string into a
 * {@link WorkflowGraphModel}.
 *
 * This handles the format stored in `status.serverlessWorkflowValidation.yaml`
 * and returned by the `getVersion` RPC as `validatedYaml`. The CNCF format
 * uses top-level `document` + `do` (array of single-key task entries) rather
 * than the Stigmer native `spec.document` + `spec.tasks` structure.
 *
 * @throws {Error} When the YAML is unparseable or lacks required structure.
 */
export function cncfYamlToGraph(yaml: string): WorkflowGraphModel {
  const parsed = parseYamlSafe(yaml);

  const document = extractDocument(parsed);
  const rawDo = parsed.do;
  if (!Array.isArray(rawDo) || rawDo.length === 0) {
    throw new Error("CNCF workflow YAML is missing required field: do (task list).");
  }

  const tasks = extractTasks(rawDo);
  if (tasks.length === 0) {
    throw new Error("CNCF workflow YAML: do list contains no valid task entries.");
  }

  const taskNameSet = new Set(tasks.map((t) => t.name));
  const nodes: WorkflowGraphNode[] = [];
  const edges: WorkflowGraphEdge[] = [];
  let edgeCounter = 0;

  const makeEdgeId = () => `e_${edgeCounter++}`;

  // Sentinel: Start node
  nodes.push({
    id: START_NODE_ID,
    taskName: "Start",
    kind: WorkflowTaskKind.workflow_task_kind_unspecified,
    category: "start",
    config: {} as JsonObject,
    position: { x: 0, y: 0 },
  });

  // Task nodes
  for (const task of tasks) {
    nodes.push({
      id: task.name,
      taskName: task.name,
      kind: task.kind,
      category: categorizeKind(task.kindString),
      config: task.config,
      ...(task.exportAs && { export: { as: task.exportAs } }),
      ...(task.then && { flow: { then: task.then } }),
      position: { x: 0, y: 0 },
    });
  }

  // Edge: start -> first task
  edges.push({ id: makeEdgeId(), source: START_NODE_ID, target: tasks[0].name });

  const tasksWithEndFlow = new Set<string>();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    if (task.then === "end") {
      tasksWithEndFlow.add(task.name);
      continue;
    }

    if (task.then && taskNameSet.has(task.then)) {
      edges.push({ id: makeEdgeId(), source: task.name, target: task.then });
      continue;
    }

    // switch_case: edges per case branch
    if (task.kindString === "switch_case" && task.switchCases) {
      for (const c of task.switchCases) {
        if (c.name && c.then && taskNameSet.has(c.then)) {
          edges.push({
            id: makeEdgeId(),
            source: task.name,
            target: c.then,
            label: c.name,
            sourceHandle: `case_${c.name}`,
          });
        }
      }
      // If no default case edge and there's a next task, add sequential fallthrough
      const hasDefault = task.switchCases.some((c) => !c.when);
      if (!hasDefault && i < tasks.length - 1) {
        edges.push({ id: makeEdgeId(), source: task.name, target: tasks[i + 1].name });
      }
      continue;
    }

    // human_input: edges per outcome (if outcomes have explicit `then`)
    if (task.kindString === "human_input" && task.outcomeThenEdges) {
      let hasOutcomeEdges = false;
      for (const o of task.outcomeThenEdges) {
        if (o.name && o.then && taskNameSet.has(o.then)) {
          edges.push({
            id: makeEdgeId(),
            source: task.name,
            target: o.then,
            label: o.name,
            sourceHandle: `outcome_${o.name}`,
          });
          hasOutcomeEdges = true;
        }
      }
      if (hasOutcomeEdges) continue;
    }

    // Default: sequential to next task
    if (i < tasks.length - 1) {
      edges.push({ id: makeEdgeId(), source: task.name, target: tasks[i + 1].name });
    } else {
      tasksWithEndFlow.add(task.name);
    }
  }

  // Sentinel: End node
  if (tasksWithEndFlow.size > 0) {
    nodes.push({
      id: END_NODE_ID,
      taskName: "End",
      kind: WorkflowTaskKind.workflow_task_kind_unspecified,
      category: "end",
      config: {} as JsonObject,
      position: { x: 0, y: 0 },
    });

    for (const name of tasksWithEndFlow) {
      edges.push({ id: makeEdgeId(), source: name, target: END_NODE_ID });
    }
  }

  return { document, nodes, edges };
}

/**
 * Detects whether a YAML string is in CNCF Serverless Workflow DSL format
 * (top-level `do` array) rather than Stigmer native format (top-level `spec`).
 */
export function isCncfWorkflowYaml(yaml: string): boolean {
  try {
    const parsed = parseYaml(yaml);
    return (
      parsed != null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "do" in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>).do)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ParsedTask {
  name: string;
  kind: WorkflowTaskKind;
  kindString: string;
  config: JsonObject;
  then?: string;
  exportAs?: string;
  switchCases?: Array<{ name: string; when?: string; then?: string }>;
  outcomeThenEdges?: Array<{ name: string; then?: string }>;
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function parseYamlSafe(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    throw new Error("Failed to parse content as YAML.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML must be a mapping document.");
  }
  return parsed as Record<string, unknown>;
}

function extractDocument(parsed: Record<string, unknown>): WorkflowGraphDocument {
  const raw = parsed.document;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("CNCF workflow YAML is missing required field: document.");
  }
  const doc = raw as Record<string, unknown>;

  return {
    dsl: typeof doc.dsl === "string" ? doc.dsl : "1.0.0",
    namespace: typeof doc.namespace === "string" ? doc.namespace : "",
    name: typeof doc.name === "string" ? doc.name : "",
    version: typeof doc.version === "string" ? doc.version : "",
    ...(typeof doc.description === "string" && { description: doc.description }),
  };
}

function extractTasks(doList: unknown[]): ParsedTask[] {
  const tasks: ParsedTask[] = [];

  for (const entry of doList) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const keys = Object.keys(entry as Record<string, unknown>);
    if (keys.length !== 1) continue;

    const taskName = keys[0];
    const taskDef = (entry as Record<string, unknown>)[taskName];
    if (!taskDef || typeof taskDef !== "object" || Array.isArray(taskDef)) continue;

    const def = taskDef as Record<string, unknown>;
    const parsed = discriminateTask(taskName, def);
    if (parsed) tasks.push(parsed);
  }

  return tasks;
}

function discriminateTask(name: string, def: Record<string, unknown>): ParsedTask | null {
  const then = typeof def.then === "string" ? def.then : undefined;
  const exportAs = extractExportAs(def);

  // switch task
  if ("switch" in def && Array.isArray(def.switch)) {
    const switchCases = parseSwitchCases(def.switch as unknown[]);
    const config = { cases: switchCases.map((c) => ({ name: c.name, when: c.when })) } as unknown as JsonObject;
    return {
      name,
      kind: stringToTaskKind("switch_case"),
      kindString: "switch_case",
      config,
      then,
      exportAs,
      switchCases,
    };
  }

  // set task
  if ("set" in def) {
    const config = (def.set ?? {}) as JsonObject;
    return {
      name,
      kind: stringToTaskKind("set_vars"),
      kindString: "set_vars",
      config,
      then,
      exportAs,
    };
  }

  // for task
  if ("for" in def) {
    const forConfig = def.for as Record<string, unknown> ?? {};
    const config = { for: forConfig } as unknown as JsonObject;
    return {
      name,
      kind: stringToTaskKind("for_each"),
      kindString: "for_each",
      config,
      then,
      exportAs,
    };
  }

  // fork task
  if ("fork" in def) {
    const forkConfig = def.fork as Record<string, unknown> ?? {};
    const config = forkConfig as unknown as JsonObject;
    return {
      name,
      kind: stringToTaskKind("fork"),
      kindString: "fork",
      config,
      then,
      exportAs,
    };
  }

  // try/catch task
  if ("try" in def) {
    const config = {} as JsonObject;
    return {
      name,
      kind: stringToTaskKind("try_catch"),
      kindString: "try_catch",
      config,
      then,
      exportAs,
    };
  }

  // run task (run_workflow in Stigmer)
  if ("run" in def) {
    const runConfig = (def.run ?? {}) as Record<string, unknown>;
    const config = runConfig as unknown as JsonObject;
    return {
      name,
      kind: stringToTaskKind("run_workflow"),
      kindString: "run_workflow",
      config,
      then,
      exportAs,
    };
  }

  // call task (agent, human_input, emit_event, http, grpc, llm, etc.)
  if ("call" in def && typeof def.call === "string") {
    const cncfCallType = def.call;
    const kindString = cncfCallToKindString(cncfCallType);
    const withObj = (def.with ?? {}) as Record<string, unknown>;
    const config = withObj as unknown as JsonObject;

    let outcomeThenEdges: ParsedTask["outcomeThenEdges"];
    if (kindString === "human_input" && Array.isArray(withObj.outcomes)) {
      outcomeThenEdges = (withObj.outcomes as Array<Record<string, unknown>>)
        .filter((o) => o && typeof o === "object" && typeof o.name === "string")
        .map((o) => ({
          name: o.name as string,
          then: typeof o.then === "string" ? o.then : undefined,
        }));
    }

    return {
      name,
      kind: stringToTaskKind(kindString),
      kindString,
      config,
      then,
      exportAs,
      outcomeThenEdges,
    };
  }

  // Fallback: unknown task type — include it so the graph is complete
  const config = {} as JsonObject;
  return {
    name,
    kind: WorkflowTaskKind.workflow_task_kind_unspecified,
    kindString: "unknown",
    config,
    then,
    exportAs,
  };
}

function parseSwitchCases(raw: unknown[]): Array<{ name: string; when?: string; then?: string }> {
  const cases: Array<{ name: string; when?: string; then?: string }> = [];

  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const keys = Object.keys(item as Record<string, unknown>);
    if (keys.length !== 1) continue;

    const caseName = keys[0];
    const caseBody = (item as Record<string, unknown>)[caseName];

    if (caseBody && typeof caseBody === "object" && !Array.isArray(caseBody)) {
      const body = caseBody as Record<string, unknown>;
      cases.push({
        name: caseName,
        when: typeof body.when === "string" ? body.when : undefined,
        then: typeof body.then === "string" ? body.then : undefined,
      });
    } else {
      cases.push({ name: caseName });
    }
  }

  return cases;
}

function extractExportAs(def: Record<string, unknown>): string | undefined {
  const exp = def.export;
  if (!exp || typeof exp !== "object" || Array.isArray(exp)) return undefined;
  const as = (exp as Record<string, unknown>).as;
  return typeof as === "string" ? as : undefined;
}
