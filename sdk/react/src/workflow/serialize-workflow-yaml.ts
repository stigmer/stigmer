import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type {
  WorkflowSpec,
  WorkflowTask,
  WorkflowBudget,
  WorkflowDocument,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { WorkflowTaskKind, BudgetExceededPolicy } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type {
  WorkflowInput,
  WorkflowTaskInput,
  WorkflowDocumentInput,
  ExportInput,
  FlowControlInput,
} from "@stigmer/sdk";
import type { JsonObject } from "@bufbuild/protobuf";

// ---------------------------------------------------------------------------
// Proto → YAML (serialize)
// ---------------------------------------------------------------------------

/**
 * Serializes a proto `Workflow` into the canonical Stigmer YAML format.
 *
 * The output uses snake_case field names and is round-trip compatible
 * with {@link parseWorkflowYaml}. Only emits `apiVersion`, `kind`,
 * `metadata`, and `spec` — the `status` field is system-managed.
 *
 * @param workflow - The proto `Workflow` resource to serialize.
 * @returns A YAML string suitable for editing and re-applying.
 *
 * @example
 * ```ts
 * const yaml = serializeWorkflowYaml(workflow);
 * // Edit yaml...
 * const input = parseWorkflowYaml(yaml, "acme");
 * await stigmer.workflow.apply(input);
 * ```
 *
 * @since T10 (YAML Editor with Graph Preview)
 */
export function serializeWorkflowYaml(workflow: Workflow): string {
  const doc: Record<string, unknown> = {
    apiVersion: workflow.apiVersion || "agentic.stigmer.ai/v1",
    kind: workflow.kind || "Workflow",
    metadata: buildMetadata(workflow),
    spec: buildWorkflowSpec(workflow.spec),
  };

  return stringifyYaml(doc, { lineWidth: 0, blockQuote: "literal" });
}

// ---------------------------------------------------------------------------
// YAML → WorkflowInput (parse)
// ---------------------------------------------------------------------------

/**
 * Parses a Stigmer Workflow YAML string into a `WorkflowInput` suitable
 * for `stigmer.workflow.apply()`.
 *
 * Handles snake_case → camelCase conversion for all nested structures
 * including tasks, env declarations, budget, and flow control.
 *
 * @param content - Raw YAML content string.
 * @param org - Target organization slug. Overrides `metadata.org` in the YAML.
 * @returns A `WorkflowInput` ready for the SDK apply/update call.
 * @throws {Error} When the YAML is malformed or missing required fields.
 *
 * @since T10 (YAML Editor with Graph Preview)
 */
export function parseWorkflowYaml(
  content: string,
  org: string,
): WorkflowInput {
  const raw = parseYamlSafe(content);
  validateWorkflowStructure(raw);

  const metadata = raw.metadata as Record<string, unknown>;
  const spec = raw.spec as Record<string, unknown>;

  const name = requireString(metadata, "name", "metadata.name");
  const slug = optString(metadata, "slug");

  const labels = optStringRecord(metadata, "labels");

  const document = extractDocument(spec);
  const tasks = extractTasks(spec);
  const env = extractEnv(spec);
  const budget = extractBudget(spec);
  const description = optString(spec, "description");

  return {
    name,
    org,
    ...(slug !== undefined && { slug }),
    ...(labels !== undefined && { labels }),
    ...(description !== undefined && { description }),
    document,
    tasks,
    ...(env !== undefined && { env }),
    ...(budget !== undefined && { budget }),
  };
}

// ---------------------------------------------------------------------------
// Serialize helpers: proto → plain object
// ---------------------------------------------------------------------------

function buildMetadata(workflow: Workflow): Record<string, unknown> {
  const m = workflow.metadata;
  if (!m) return {};

  const result: Record<string, unknown> = { name: m.name };

  if (m.org) result.org = m.org;
  if (m.slug && m.slug !== m.name) result.slug = m.slug;
  if (m.labels && Object.keys(m.labels).length > 0) {
    result.labels = { ...m.labels };
  }

  return result;
}

function buildWorkflowSpec(
  spec: WorkflowSpec | undefined,
): Record<string, unknown> {
  if (!spec) return {};

  const result: Record<string, unknown> = {};

  if (spec.description) result.description = spec.description;
  if (spec.document) result.document = buildDocument(spec.document);
  if (spec.tasks.length > 0) {
    result.tasks = spec.tasks.map(buildTask);
  }
  if (spec.env && Object.keys(spec.env).length > 0) {
    result.env = buildEnvMap(spec.env);
  }
  if (spec.budget && hasBudgetValues(spec.budget)) {
    result.budget = buildBudget(spec.budget);
  }

  return result;
}

function buildDocument(doc: WorkflowDocument): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (doc.dsl) result.dsl = doc.dsl;
  if (doc.namespace) result.namespace = doc.namespace;
  if (doc.name) result.name = doc.name;
  if (doc.version) result.version = doc.version;
  if (doc.description) result.description = doc.description;

  return result;
}

function buildTask(task: WorkflowTask): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: task.name,
    kind: taskKindToString(task.kind),
  };

  if (task.taskConfig && Object.keys(task.taskConfig).length > 0) {
    result.task_config = structToPlain(task.taskConfig);
  }

  if (task.export?.as) {
    result.export = { as: task.export.as };
  }

  if (task.flow?.then) {
    result.flow = { then: task.flow.then };
  }

  return result;
}

function buildEnvMap(
  env: Record<string, EnvVarDeclaration>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [key, decl] of Object.entries(env)) {
    const entry: Record<string, unknown> = {};
    if (decl.isSecret) entry.is_secret = true;
    if (decl.description) entry.description = decl.description;
    if (decl.optional) entry.optional = true;
    result[key] = entry;
  }

  return result;
}

function buildBudget(budget: WorkflowBudget): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const costMicros = Number(budget.maxCostMicros);
  const totalTokens = Number(budget.maxTotalTokens);

  if (costMicros > 0) result.max_cost_micros = costMicros;
  if (totalTokens > 0) result.max_total_tokens = totalTokens;
  if (budget.maxDurationSeconds > 0) {
    result.max_duration_seconds = budget.maxDurationSeconds;
  }
  if (
    budget.onExceeded !== BudgetExceededPolicy.budget_exceeded_policy_unspecified
  ) {
    result.on_exceeded = budgetPolicyToString(budget.onExceeded);
  }

  return result;
}

function hasBudgetValues(budget: WorkflowBudget): boolean {
  return (
    Number(budget.maxCostMicros) > 0 ||
    Number(budget.maxTotalTokens) > 0 ||
    budget.maxDurationSeconds > 0
  );
}

// ---------------------------------------------------------------------------
// Parse helpers: plain object → WorkflowInput
// ---------------------------------------------------------------------------

function parseYamlSafe(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    throw new Error("Failed to parse content as YAML.");
  }

  if (!isObj(parsed)) {
    throw new Error("YAML must be a mapping document, not a scalar or list.");
  }

  return parsed;
}

function validateWorkflowStructure(doc: Record<string, unknown>): void {
  const kind = doc.kind;
  if (typeof kind === "string" && kind !== "Workflow") {
    throw new Error(
      `Expected resource kind "Workflow", got "${kind}".`,
    );
  }

  if (!isObj(doc.metadata)) {
    throw new Error("Workflow YAML is missing required field: metadata.");
  }
  if (!isObj(doc.spec)) {
    throw new Error("Workflow YAML is missing required field: spec.");
  }
}

function extractDocument(
  spec: Record<string, unknown>,
): WorkflowDocumentInput {
  const raw = spec.document;
  if (!isObj(raw)) {
    throw new Error("Workflow YAML is missing required field: spec.document.");
  }

  return {
    dsl: optString(raw, "dsl") ?? "1.0.0",
    namespace: requireString(raw, "namespace", "spec.document.namespace"),
    name: requireString(raw, "name", "spec.document.name"),
    version: requireString(raw, "version", "spec.document.version"),
    ...(raw.description && typeof raw.description === "string"
      ? { description: raw.description }
      : {}),
  };
}

function extractTasks(
  spec: Record<string, unknown>,
): WorkflowTaskInput[] {
  const raw = spec.tasks;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      "Workflow YAML is missing required field: spec.tasks (must be a non-empty list).",
    );
  }

  return raw.filter(isObj).map((entry, idx): WorkflowTaskInput => {
    const name = entry.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(
        `Workflow YAML: task at index ${idx} is missing required field: name.`,
      );
    }

    const kindStr = entry.kind;
    if (typeof kindStr !== "string" || kindStr.length === 0) {
      throw new Error(
        `Workflow YAML: task "${name}" is missing required field: kind.`,
      );
    }

    const kindEnum = stringToTaskKind(kindStr);
    if (kindEnum === undefined) {
      throw new Error(
        `Workflow YAML: task "${name}" has unknown kind "${kindStr}".`,
      );
    }

    const taskConfig =
      (entry.task_config ?? entry.taskConfig) as JsonObject | undefined;
    if (!isObj(taskConfig)) {
      throw new Error(
        `Workflow YAML: task "${name}" is missing required field: task_config.`,
      );
    }

    const exportBlock = entry.export ?? entry.export;
    const flowBlock = entry.flow;

    const result: WorkflowTaskInput = {
      name,
      kind: kindEnum,
      taskConfig: taskConfig as JsonObject,
    };

    if (isObj(exportBlock)) {
      const asVal = (exportBlock as Record<string, unknown>).as;
      if (typeof asVal === "string" && asVal.length > 0) {
        (result as { export?: ExportInput }).export = { as: asVal };
      }
    }

    if (isObj(flowBlock)) {
      const thenVal = (flowBlock as Record<string, unknown>).then;
      if (typeof thenVal === "string" && thenVal.length > 0) {
        (result as { flow?: FlowControlInput }).flow = { then: thenVal };
      }
    }

    return result;
  });
}

function extractEnv(
  spec: Record<string, unknown>,
): WorkflowInput["env"] | undefined {
  const raw = spec.env;
  if (!isObj(raw)) return undefined;

  const result: NonNullable<WorkflowInput["env"]> = {};
  let hasEntries = false;

  for (const [key, val] of Object.entries(raw)) {
    if (!isObj(val)) continue;

    const isSecret = val.is_secret ?? val.isSecret;
    const description = val.description;
    const optional = val.optional;

    result[key] = {
      ...(typeof isSecret === "boolean" && { isSecret }),
      ...(typeof description === "string" && { description }),
      ...(typeof optional === "boolean" && { optional }),
    };
    hasEntries = true;
  }

  return hasEntries ? result : undefined;
}

function extractBudget(
  spec: Record<string, unknown>,
): WorkflowInput["budget"] | undefined {
  const raw = spec.budget;
  if (!isObj(raw)) return undefined;

  const maxCostMicros =
    toBigIntSafe(raw.max_cost_micros ?? raw.maxCostMicros);
  const maxTotalTokens =
    toBigIntSafe(raw.max_total_tokens ?? raw.maxTotalTokens);
  const maxDurationSeconds = toNumberSafe(
    raw.max_duration_seconds ?? raw.maxDurationSeconds,
  );
  const onExceededStr = raw.on_exceeded ?? raw.onExceeded;
  const onExceeded =
    typeof onExceededStr === "string"
      ? stringToBudgetPolicy(onExceededStr)
      : undefined;

  const hasValues =
    (maxCostMicros !== undefined && maxCostMicros > BigInt(0)) ||
    (maxTotalTokens !== undefined && maxTotalTokens > BigInt(0)) ||
    (maxDurationSeconds !== undefined && maxDurationSeconds > 0);

  if (!hasValues) return undefined;

  return {
    ...(maxCostMicros !== undefined && { maxCostMicros }),
    ...(maxTotalTokens !== undefined && { maxTotalTokens }),
    ...(maxDurationSeconds !== undefined && { maxDurationSeconds }),
    ...(onExceeded !== undefined && { onExceeded }),
  };
}

// ---------------------------------------------------------------------------
// Enum ↔ string conversion
// ---------------------------------------------------------------------------

const TASK_KIND_STRINGS: ReadonlyMap<WorkflowTaskKind, string> = new Map(
  Object.entries(WorkflowTaskKind)
    .filter(
      (entry): entry is [string, WorkflowTaskKind] =>
        typeof entry[1] === "number" &&
        entry[1] !== WorkflowTaskKind.workflow_task_kind_unspecified,
    )
    .map(([name, value]) => [value, name]),
);

const STRING_TO_TASK_KIND: ReadonlyMap<string, WorkflowTaskKind> = new Map(
  Array.from(TASK_KIND_STRINGS.entries()).map(([value, name]) => [name, value]),
);

function taskKindToString(kind: WorkflowTaskKind): string {
  return TASK_KIND_STRINGS.get(kind) ?? `unknown_${kind}`;
}

function stringToTaskKind(str: string): WorkflowTaskKind | undefined {
  return STRING_TO_TASK_KIND.get(str);
}

const BUDGET_POLICY_STRINGS: ReadonlyMap<BudgetExceededPolicy, string> =
  new Map([
    [BudgetExceededPolicy.budget_exceeded_terminate, "budget_exceeded_terminate"],
    [
      BudgetExceededPolicy.budget_exceeded_human_review,
      "budget_exceeded_human_review",
    ],
    [BudgetExceededPolicy.budget_exceeded_warn, "budget_exceeded_warn"],
  ]);

const STRING_TO_BUDGET_POLICY: ReadonlyMap<string, BudgetExceededPolicy> =
  new Map(
    Array.from(BUDGET_POLICY_STRINGS.entries()).map(([v, n]) => [n, v]),
  );

function budgetPolicyToString(policy: BudgetExceededPolicy): string {
  return BUDGET_POLICY_STRINGS.get(policy) ?? "budget_exceeded_policy_unspecified";
}

function stringToBudgetPolicy(
  str: string,
): BudgetExceededPolicy | undefined {
  return STRING_TO_BUDGET_POLICY.get(str);
}

// ---------------------------------------------------------------------------
// Struct / primitive helpers
// ---------------------------------------------------------------------------

/**
 * Converts a protobuf Struct (or JsonObject) to a plain JS object,
 * handling BigInt → number conversion for YAML serialization.
 */
function structToPlain(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return Number(obj);
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(structToPlain);
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = structToPlain(v);
  }
  return result;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  displayPath: string,
): string {
  const val = obj[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(
      `Workflow YAML is missing required field: ${displayPath}.`,
    );
  }
  return val;
}

function optString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = obj[key];
  return typeof val === "string" && val.length > 0 ? val : undefined;
}

function optStringRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const val = obj[key];
  if (!isObj(val)) return undefined;

  const result: Record<string, string> = {};
  let hasEntries = false;
  for (const [k, v] of Object.entries(val)) {
    if (typeof v === "string") {
      result[k] = v;
      hasEntries = true;
    }
  }
  return hasEntries ? result : undefined;
}

function toBigIntSafe(val: unknown): bigint | undefined {
  if (typeof val === "bigint") return val;
  if (typeof val === "number" && Number.isFinite(val)) return BigInt(Math.round(val));
  if (typeof val === "string") {
    try {
      return BigInt(val);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function toNumberSafe(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
