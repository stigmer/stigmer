/**
 * SetTask builder — evaluates expressions in the `set` object and
 * merges results into state.data. The simplest task type: pure state
 * mutation with no I/O.
 *
 * Mirrors Go's `task_builder_set.go`.
 */

import type {
  SetTaskDef,
  TaskBuilder,
  TaskExecutorFn,
  WorkflowState,
} from "../types.js";

export class SetTaskBuilder implements TaskBuilder {
  readonly taskName: string;
  readonly taskDef: SetTaskDef;

  constructor(taskName: string, taskDef: SetTaskDef) {
    this.taskName = taskName;
    this.taskDef = taskDef;
  }

  build(): TaskExecutorFn {
    return async (_input, state, ctx) => {
      const setObject = structuredClone(this.taskDef.set);

      const stateVars = state.getAsMap();
      const result = await ctx.evaluateExpressions(
        collectExpressions(setObject),
        null,
        stateVars,
      );

      const evaluated = substituteResults(setObject, result);

      state.addData(evaluated as Record<string, unknown>);
      return evaluated;
    };
  }

  async shouldRun(): Promise<boolean> {
    return true;
  }
}

/**
 * Collects all string expressions (`${ ... }`) from a nested object
 * into a flat map keyed by their JSON path. Non-expression strings
 * and non-string values are skipped.
 */
function collectExpressions(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const expressions: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string" && value.startsWith("${ ") && value.endsWith(" }")) {
      expressions[path] = value.slice(3, -2);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(
        expressions,
        collectExpressions(value as Record<string, unknown>, path),
      );
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const itemPath = `${path}[${i}]`;
        if (typeof value[i] === "string" && value[i].startsWith("${ ") && value[i].endsWith(" }")) {
          expressions[itemPath] = value[i].slice(3, -2);
        } else if (value[i] !== null && typeof value[i] === "object") {
          Object.assign(
            expressions,
            collectExpressions(value[i] as Record<string, unknown>, itemPath),
          );
        }
      }
    }
  }

  return expressions;
}

/**
 * Substitutes evaluated expression results back into the original
 * object structure. Expression paths (e.g., "body.userId") are
 * resolved to their positions in the object tree.
 */
function substituteResults(
  obj: Record<string, unknown>,
  results: Record<string, unknown>,
): Record<string, unknown> {
  for (const [path, value] of Object.entries(results)) {
    setNestedValue(obj, path, value);
  }
  return obj;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = parsePath(path);
  let current: unknown = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof part === "number") {
      current = (current as unknown[])[part];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  const lastPart = parts[parts.length - 1];
  if (typeof lastPart === "number") {
    (current as unknown[])[lastPart] = value;
  } else {
    (current as Record<string, unknown>)[lastPart] = value;
  }
}

function parsePath(path: string): (string | number)[] {
  const parts: (string | number)[] = [];
  const segments = path.split(".");

  for (const segment of segments) {
    const bracketMatch = segment.match(/^(.+?)\[(\d+)\]$/);
    if (bracketMatch) {
      parts.push(bracketMatch[1]);
      parts.push(Number(bracketMatch[2]));
    } else {
      parts.push(segment);
    }
  }

  return parts;
}
