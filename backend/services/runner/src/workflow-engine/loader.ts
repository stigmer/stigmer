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
    return { kind: "raise", ...base, raise: raw.raise as any };
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

function parseCatchConfig(raw: unknown): any {
  if (!raw || typeof raw !== "object") return {};
  const catchRaw = raw as Record<string, unknown>;
  return {
    errors: catchRaw.errors,
    as: typeof catchRaw.as === "string" ? catchRaw.as : undefined,
    when: typeof catchRaw.when === "string" ? catchRaw.when : undefined,
    do: catchRaw.do ? parseTaskList(catchRaw.do) : undefined,
    retry: catchRaw.retry,
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
    org: typeof obj.org === "string" ? obj.org : undefined,
    env: obj.env as Record<string, string> | undefined,
    config: obj.config as AgentCallConfig["config"],
    output: obj.output as AgentCallConfig["output"],
    harness,
  };
}
