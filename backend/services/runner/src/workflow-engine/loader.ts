/**
 * YAML workflow loader — parses a CNCF Serverless Workflow DSL 1.0.0
 * document from YAML into our serializable WorkflowModel.
 *
 * Runs outside the Temporal workflow sandbox (activity-side).
 * The parsed model is passed as input to the workflow function.
 *
 * Design decision (DD-W02): We parse YAML directly and build our
 * own WorkflowModel types rather than using the CNCF SDK classes.
 * This avoids the SDK's strict Ajv validation issues (rejects
 * `document.description`) and decouples us from SDK version changes.
 *
 * Mirrors Go's `loader.go`: YAML → JSON → model with DSL version check.
 */

import yaml from "js-yaml";
import { satisfies } from "semver";
import type {
  WorkflowModel,
  WorkflowDocument,
  TaskList,
  TaskEntry,
  TaskDef,
  TaskBase,
  SwitchCase,
  InputDef,
  OutputDef,
  ExportDef,
  AgentCallConfig,
  CatchConfig,
  RaiseConfig,
  RetryConfig,
  RetryLimit,
  BackoffConfig,
  JitterConfig,
  DurationDef,
  HumanInputTimeoutPolicy,
} from "./types.js";

const SUPPORTED_DSL_RANGE = ">=1.0.0 <2.0.0";

/**
 * Parses a YAML string into a WorkflowModel. Validates the DSL
 * version and discriminates task types into our typed union.
 *
 * @throws Error if YAML is invalid, DSL version is unsupported,
 *         or the document structure is malformed.
 */
export function loadWorkflowFromYaml(yamlContent: string): WorkflowModel {
  const raw = yaml.load(yamlContent) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid workflow YAML: document is not an object");
  }

  const document = parseDocument(raw.document);
  validateDslVersion(document.dsl);

  const doList = parseTaskList(raw.do);
  if (doList.length === 0) {
    throw new Error("Workflow must have at least one task in 'do'");
  }

  return {
    document,
    do: doList,
    input: raw.input ? parseInputDef(raw.input) : undefined,
    output: raw.output ? parseOutputDef(raw.output) : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Document Parsing
// ─────────────────────────────────────────────────────────────────────

function parseDocument(raw: unknown): WorkflowDocument {
  if (!raw || typeof raw !== "object") {
    throw new Error("Workflow must have a 'document' field");
  }
  const doc = raw as Record<string, unknown>;

  if (typeof doc.dsl !== "string") {
    throw new Error("document.dsl must be a string");
  }
  if (typeof doc.name !== "string") {
    throw new Error("document.name must be a string");
  }

  return {
    dsl: doc.dsl,
    name: doc.name,
    namespace: typeof doc.namespace === "string" ? doc.namespace : undefined,
    version: typeof doc.version === "string" ? doc.version : undefined,
    description: typeof doc.description === "string" ? doc.description : undefined,
  };
}

function validateDslVersion(dsl: string): void {
  if (!satisfies(dsl, SUPPORTED_DSL_RANGE)) {
    throw new Error(
      `Unsupported DSL version '${dsl}'. Supported range: ${SUPPORTED_DSL_RANGE}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Task List Parsing
// ─────────────────────────────────────────────────────────────────────

function parseTaskList(raw: unknown): TaskList {
  if (!Array.isArray(raw)) {
    throw new Error("'do' must be an array of task entries");
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Task entry at index ${index} is not an object`);
    }
    const keys = Object.keys(entry as Record<string, unknown>);
    if (keys.length !== 1) {
      throw new Error(
        `Task entry at index ${index} must have exactly one key (task name), got: ${keys.join(", ")}`,
      );
    }

    const taskName = keys[0];
    const taskRaw = (entry as Record<string, unknown>)[taskName] as Record<string, unknown>;

    return {
      key: taskName,
      task: discriminateTask(taskName, taskRaw),
    } satisfies TaskEntry;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Task Type Discrimination
// ─────────────────────────────────────────────────────────────────────

function discriminateTask(taskName: string, raw: Record<string, unknown>): TaskDef {
  const base = parseTaskBase(raw);

  if ("set" in raw) {
    return { kind: "set", ...base, set: raw.set as Record<string, unknown> };
  }

  if ("switch" in raw) {
    return { kind: "switch", ...base, switch: parseSwitchCases(raw.switch) };
  }

  if ("do" in raw && !("for" in raw) && !("try" in raw)) {
    return { kind: "do", ...base, do: parseTaskList(raw.do) };
  }

  if ("for" in raw) {
    const forConfig = raw.for as Record<string, unknown>;
    return {
      kind: "for",
      ...base,
      for: {
        each: typeof forConfig.each === "string" ? forConfig.each : undefined,
        in: forConfig.in as string,
        at: typeof forConfig.at === "string" ? forConfig.at : undefined,
      },
      while: typeof raw.while === "string" ? raw.while : undefined,
      do: parseTaskList(raw.do),
    };
  }

  if ("fork" in raw) {
    const forkConfig = raw.fork as Record<string, unknown>;
    return {
      kind: "fork",
      ...base,
      fork: {
        branches: parseTaskList(forkConfig.branches),
        compete: typeof forkConfig.compete === "boolean" ? forkConfig.compete : undefined,
      },
    };
  }

  if ("try" in raw) {
    return {
      kind: "try",
      ...base,
      try: parseTaskList(raw.try),
      catch: parseCatchConfig(raw.catch),
    };
  }

  if ("wait" in raw) {
    return { kind: "wait", ...base, wait: raw.wait as any };
  }

  if ("listen" in raw) {
    return { kind: "listen", ...base, listen: raw.listen as any };
  }

  if ("raise" in raw) {
    return { kind: "raise", ...base, raise: parseRaiseConfig(taskName, raw.raise) };
  }

  if ("call" in raw) {
    const callValue = raw.call as string;

    if (callValue === "http") {
      return {
        kind: "call:http",
        ...base,
        call: "http",
        with: raw.with as any,
      };
    }

    if (callValue === "grpc") {
      return {
        kind: "call:grpc",
        ...base,
        call: "grpc",
        with: raw.with as any,
      };
    }

    if (callValue === "agent") {
      return {
        kind: "call:agent",
        ...base,
        call: "agent",
        with: parseAgentCallConfig(raw.with),
      };
    }

    if (callValue === "human_input") {
      return {
        kind: "human_input",
        ...base,
        humanInput: parseHumanInputConfig(taskName, raw.with),
      };
    }

    return {
      kind: "call:function",
      ...base,
      call: callValue,
      with: raw.with as Record<string, unknown> | undefined,
    };
  }

  if ("run" in raw) {
    return { kind: "run", ...base, run: raw.run as any };
  }

  throw new Error(
    `Cannot determine task type for '${taskName}'. ` +
    `Expected one of: set, switch, do, for, fork, try, wait, listen, raise, call, run`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Task Base Properties
// ─────────────────────────────────────────────────────────────────────

function parseTaskBase(raw: Record<string, unknown>): TaskBase {
  return {
    if: typeof raw.if === "string" ? raw.if : undefined,
    input: raw.input ? parseInputDef(raw.input) : undefined,
    output: raw.output ? parseOutputDef(raw.output) : undefined,
    export: raw.export ? parseExportDef(raw.export) : undefined,
    then: typeof raw.then === "string" ? raw.then : undefined,
    metadata: raw.metadata as Record<string, unknown> | undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Switch Cases
// ─────────────────────────────────────────────────────────────────────

function parseSwitchCases(raw: unknown): SwitchCase[] {
  if (!Array.isArray(raw)) {
    throw new Error("'switch' must be an array of cases");
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Switch case at index ${index} is not an object`);
    }
    const keys = Object.keys(entry as Record<string, unknown>);
    if (keys.length !== 1) {
      throw new Error(
        `Switch case at index ${index} must have exactly one key (case name)`,
      );
    }
    const caseName = keys[0];
    const caseRaw = (entry as Record<string, unknown>)[caseName] as Record<string, unknown>;

    return {
      name: caseName,
      when: typeof caseRaw.when === "string" ? caseRaw.when : undefined,
      then: caseRaw.then as string,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Catch Config
// ─────────────────────────────────────────────────────────────────────

function parseCatchConfig(raw: unknown): CatchConfig {
  if (!raw || typeof raw !== "object") return {};
  const catchRaw = raw as Record<string, unknown>;

  return {
    errors: catchRaw.errors as CatchConfig["errors"],
    as: typeof catchRaw.as === "string" ? catchRaw.as : undefined,
    when: typeof catchRaw.when === "string" ? catchRaw.when : undefined,
    do: catchRaw.do ? parseTaskList(catchRaw.do) : undefined,
    retry: catchRaw.retry ? parseRetryConfig(catchRaw.retry) : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Retry Config Parsing
// ─────────────────────────────────────────────────────────────────────

function parseRetryConfig(raw: unknown): RetryConfig {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;

  return {
    when: typeof obj.when === "string" ? obj.when : undefined,
    exceptWhen: typeof obj.exceptWhen === "string" ? obj.exceptWhen : undefined,
    delay: obj.delay ? parseDurationDef(obj.delay) : undefined,
    backoff: obj.backoff ? parseBackoffConfig(obj.backoff) : undefined,
    limit: obj.limit ? parseRetryLimit(obj.limit) : undefined,
    jitter: obj.jitter ? parseJitterConfig(obj.jitter) : undefined,
  };
}

function parseDurationDef(raw: unknown): DurationDef {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  return {
    days: typeof obj.days === "number" ? obj.days : undefined,
    hours: typeof obj.hours === "number" ? obj.hours : undefined,
    minutes: typeof obj.minutes === "number" ? obj.minutes : undefined,
    seconds: typeof obj.seconds === "number" ? obj.seconds : undefined,
    milliseconds: typeof obj.milliseconds === "number" ? obj.milliseconds : undefined,
  };
}

function parseBackoffConfig(raw: unknown): BackoffConfig {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;

  const strategies = ["constant", "exponential", "linear"] as const;
  const present = strategies.filter((s) => s in obj);

  if (present.length > 1) {
    throw new Error(
      `Retry backoff must specify exactly one strategy (constant, exponential, or linear), ` +
      `got: ${present.join(", ")}`,
    );
  }

  return {
    constant: obj.constant != null ? (obj.constant as Record<string, unknown>) : undefined,
    exponential: obj.exponential != null ? (obj.exponential as Record<string, unknown>) : undefined,
    linear: obj.linear != null ? (obj.linear as Record<string, unknown>) : undefined,
  };
}

function parseRetryLimit(raw: unknown): RetryLimit {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;

  let attempt: RetryLimit["attempt"];
  if (obj.attempt && typeof obj.attempt === "object") {
    const attemptRaw = obj.attempt as Record<string, unknown>;
    const count = attemptRaw.count;
    if (typeof count === "number" && count > 0 && Number.isInteger(count)) {
      attempt = { count };
    }
  }

  return {
    attempt,
    duration: obj.duration ? parseDurationDef(obj.duration) : undefined,
  };
}

function parseJitterConfig(raw: unknown): JitterConfig {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;

  return {
    from: obj.from ? parseDurationDef(obj.from) : undefined,
    to: obj.to ? parseDurationDef(obj.to) : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Input / Output / Export
// ─────────────────────────────────────────────────────────────────────

function parseInputDef(raw: unknown): InputDef {
  if (typeof raw !== "object" || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  return {
    from: obj.from as string | Record<string, unknown> | undefined,
    schema: obj.schema as Record<string, unknown> | undefined,
  };
}

function parseOutputDef(raw: unknown): OutputDef {
  if (typeof raw !== "object" || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  return {
    as: obj.as as string | Record<string, unknown> | undefined,
    schema: obj.schema as Record<string, unknown> | undefined,
  };
}

function parseExportDef(raw: unknown): ExportDef {
  if (typeof raw !== "object" || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  return {
    as: obj.as as string | Record<string, unknown> | undefined,
    schema: obj.schema as Record<string, unknown> | undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Raise Config Parsing
// ─────────────────────────────────────────────────────────────────────

function parseRaiseConfig(taskName: string, raw: unknown): RaiseConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`raise task '${taskName}' requires an error definition`);
  }
  const obj = raw as Record<string, unknown>;

  const errorDef = obj.error as Record<string, unknown> | undefined;
  if (!errorDef || typeof errorDef !== "object") {
    throw new Error(`raise task '${taskName}' requires 'error' in raise definition`);
  }

  if (typeof errorDef.type !== "string" || !errorDef.type) {
    throw new Error(`raise task '${taskName}' requires 'error.type' (string)`);
  }
  if (typeof errorDef.status !== "number") {
    throw new Error(`raise task '${taskName}' requires 'error.status' (number)`);
  }

  return {
    error: {
      type: errorDef.type,
      status: errorDef.status,
      title: typeof errorDef.title === "string" ? errorDef.title : undefined,
      detail: typeof errorDef.detail === "string" ? errorDef.detail : undefined,
      instance: typeof errorDef.instance === "string" ? errorDef.instance : undefined,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Agent Call Config Parsing
// ─────────────────────────────────────────────────────────────────────

const HARNESS_SHORTHANDS: Record<string, string> = {
  native: "HARNESS_NATIVE",
  cursor: "HARNESS_CURSOR",
};

function parseAgentCallConfig(raw: unknown): AgentCallConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("call:agent task requires a 'with' configuration block");
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.agent !== "string" || !obj.agent) {
    throw new Error("call:agent requires 'agent' (slug or org/slug) in 'with'");
  }
  if (typeof obj.message !== "string" || !obj.message) {
    throw new Error("call:agent requires 'message' in 'with'");
  }

  const harness = typeof obj.harness === "string"
    ? (HARNESS_SHORTHANDS[obj.harness.toLowerCase()] ?? obj.harness)
    : undefined;

  return {
    agent: obj.agent,
    message: obj.message,
    env: obj.env as Record<string, string> | undefined,
    run_config: parseAgentCallRunConfig(obj.run_config),
    output: obj.output as AgentCallConfig["output"],
    harness,
    workspace_entries: parseAgentCallWorkspaceEntries(obj.workspace_entries),
  };
}

/**
 * Parses workspace entries with structural validation. Write-time
 * validation already enforces the git-only constraint, so a malformed
 * entry here means a converter defect or hand-edited YAML — either way
 * an error the author must hear about, not a silent skip.
 */
function parseAgentCallWorkspaceEntries(
  raw: unknown,
): AgentCallConfig["workspace_entries"] {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error("call:agent 'workspace_entries' must be a list");
  }

  return raw.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`call:agent 'workspace_entries[${i}]' must be a mapping`);
    }
    const entry = item as Record<string, unknown>;
    const source = entry.source as Record<string, unknown> | undefined;
    const gitRepo = source?.git_repo as Record<string, unknown> | undefined;
    if (!gitRepo || typeof gitRepo.url !== "string" || !gitRepo.url) {
      throw new Error(
        `call:agent 'workspace_entries[${i}]' requires 'source.git_repo.url' ` +
        `(the workflow surface supports git sources only)`,
      );
    }
    return {
      name: typeof entry.name === "string" && entry.name ? entry.name : undefined,
      source: {
        git_repo: {
          url: gitRepo.url,
          branch: typeof gitRepo.branch === "string" && gitRepo.branch ? gitRepo.branch : undefined,
        },
      },
    };
  });
}

/**
 * Parses the shared RunConfig block with per-key validation rather than a
 * bare cast: a typo'd key or mistyped value is an authoring error the
 * author must hear about, not something to silently carry along.
 */
function parseAgentCallRunConfig(raw: unknown): AgentCallConfig["run_config"] {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("call:agent 'run_config' must be a mapping");
  }
  const obj = raw as Record<string, unknown>;

  const known = new Set([
    "model_name", "max_cost_usd", "max_tool_rounds", "service_tier", "thinking_mode",
  ]);
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      throw new Error(
        `call:agent 'run_config' has unknown field '${key}' ` +
        `(expected: model_name, max_cost_usd, max_tool_rounds, service_tier, thinking_mode)`,
      );
    }
  }

  const modelName = obj.model_name;
  if (modelName !== undefined && typeof modelName !== "string") {
    throw new Error("call:agent 'run_config.model_name' must be a string");
  }
  const maxCostUsd = obj.max_cost_usd;
  if (maxCostUsd !== undefined && (typeof maxCostUsd !== "number" || maxCostUsd < 0)) {
    throw new Error("call:agent 'run_config.max_cost_usd' must be a number >= 0");
  }
  const maxToolRounds = obj.max_tool_rounds;
  if (maxToolRounds !== undefined && (typeof maxToolRounds !== "number" || maxToolRounds < 0)) {
    throw new Error("call:agent 'run_config.max_tool_rounds' must be a number >= 0");
  }
  const serviceTier = parseServiceTier(obj.service_tier);
  const thinkingMode = parseThinkingMode(obj.thinking_mode);

  return {
    model_name: modelName,
    max_cost_usd: maxCostUsd,
    max_tool_rounds: maxToolRounds,
    service_tier: serviceTier,
    thinking_mode: thinkingMode,
  };
}

/**
 * Maps YAML service-tier shorthands to canonical enum names, mirroring
 * HARNESS_SHORTHANDS. Unknown values are authoring errors: the tier
 * exists to make pricing deterministic, so a typo must never silently
 * fall back to the default.
 */
const SERVICE_TIER_SHORTHANDS: Record<string, string> = {
  standard: "SERVICE_TIER_STANDARD",
  fast: "SERVICE_TIER_FAST",
};

function parseServiceTier(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    throw new Error("call:agent 'run_config.service_tier' must be a string");
  }
  const canonical =
    SERVICE_TIER_SHORTHANDS[raw.toLowerCase()] ??
    (Object.values(SERVICE_TIER_SHORTHANDS).includes(raw) ? raw : undefined);
  if (!canonical) {
    throw new Error(
      `call:agent 'run_config.service_tier' has unknown value '${raw}' ` +
      `(expected: standard, fast)`,
    );
  }
  return canonical;
}

/**
 * Maps YAML thinking-mode shorthands to canonical enum names, mirroring
 * SERVICE_TIER_SHORTHANDS (stigmer/stigmer#772). Unknown values are
 * authoring errors: the mode exists to make the served variant
 * deterministic, so a typo must never silently fall back to the default.
 */
const THINKING_MODE_SHORTHANDS: Record<string, string> = {
  disabled: "THINKING_MODE_DISABLED",
  enabled: "THINKING_MODE_ENABLED",
};

function parseThinkingMode(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    throw new Error("call:agent 'run_config.thinking_mode' must be a string");
  }
  const canonical =
    THINKING_MODE_SHORTHANDS[raw.toLowerCase()] ??
    (Object.values(THINKING_MODE_SHORTHANDS).includes(raw) ? raw : undefined);
  if (!canonical) {
    throw new Error(
      `call:agent 'run_config.thinking_mode' has unknown value '${raw}' ` +
      `(expected: disabled, enabled)`,
    );
  }
  return canonical;
}

/**
 * Maps on_timeout values to the runner's internal policy words, mirroring
 * SERVICE_TIER_SHORTHANDS. The persisted CNCF YAML carries the proto enum
 * NAMES (the server converter emits `HumanInputTimeoutPolicy.String()`),
 * while hand-written fixtures use the lowercase words — both are accepted.
 * Unknown values are authoring errors: a timeout policy must never silently
 * fall back to fail (stigmer/stigmer#779 — the unvalidated cast let every
 * enum-name policy reach the orchestrator unrecognized, so gates configured
 * to auto-approve/deny failed at their first real timeout instead).
 */
const ON_TIMEOUT_VOCABULARY: Record<string, HumanInputTimeoutPolicy> = {
  fail: "fail",
  approve: "approve",
  deny: "deny",
  escalate: "escalate",
  HUMAN_INPUT_TIMEOUT_FAIL: "fail",
  HUMAN_INPUT_TIMEOUT_APPROVE: "approve",
  HUMAN_INPUT_TIMEOUT_DENY: "deny",
  HUMAN_INPUT_TIMEOUT_ESCALATE: "escalate",
};

function parseOnTimeout(
  taskName: string,
  raw: unknown,
): HumanInputTimeoutPolicy | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    throw new Error(`human_input task '${taskName}': 'on_timeout' must be a string`);
  }
  const policy = ON_TIMEOUT_VOCABULARY[raw];
  if (!policy) {
    throw new Error(
      `human_input task '${taskName}': unknown on_timeout value '${raw}' ` +
      `(expected: fail, approve, deny, escalate, or a HUMAN_INPUT_TIMEOUT_* enum name)`,
    );
  }
  return policy;
}

function parseHumanInputConfig(taskName: string, raw: unknown): import("./types.js").HumanInputConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`human_input task '${taskName}' requires a 'with' configuration block`);
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.prompt !== "string" || !obj.prompt) {
    throw new Error(`human_input task '${taskName}' requires 'prompt' in 'with'`);
  }

  const outcomes = Array.isArray(obj.outcomes) && obj.outcomes.length > 0
    ? obj.outcomes.map((o: any) => ({ name: o.name, label: o.label, then: o.then }))
    : undefined;
  const onTimeout = parseOnTimeout(taskName, obj.on_timeout);

  // The escalate policy's outcome-by-name contract (stigmer/stigmer#781):
  // a timeout resolves to the outcome NAMED "escalate", so that outcome must
  // exist and declare where the escalation branch goes. Checked at load so a
  // misconfigured gate fails before it ever waits on a reviewer — the server
  // validator enforces the same shape at apply; this covers hand-written YAML.
  if (onTimeout === "escalate") {
    const escalation = outcomes?.find((o) => o.name === "escalate");
    if (!escalation || !escalation.then) {
      throw new Error(
        `human_input task '${taskName}': on_timeout policy 'escalate' requires ` +
        `an outcome named 'escalate' with 'then' set (the timeout resolves to ` +
        `that outcome and follows its 'then' branch)`,
      );
    }
  }

  return {
    prompt: obj.prompt,
    outcomes,
    formSchema: obj.form_schema && typeof obj.form_schema === "object"
      ? obj.form_schema as Record<string, unknown>
      : undefined,
    approvers: Array.isArray(obj.approvers)
      ? obj.approvers.filter((a: unknown) => typeof a === "string") as string[]
      : undefined,
    timeout: typeof obj.timeout === "number" ? obj.timeout : undefined,
    onTimeout,
    // Any JSON shape is a valid payload (expression string, object, array),
    // so only null/undefined mean "no payload" here.
    payload: obj.payload ?? undefined,
    uiHint: typeof obj.ui_hint === "string" && obj.ui_hint ? obj.ui_hint : undefined,
  };
}
