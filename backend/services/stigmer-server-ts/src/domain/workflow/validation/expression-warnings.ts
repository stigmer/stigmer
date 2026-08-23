/**
 * Expression-mistake warnings — ports
 * pkg/domain/workflow/validation/expression_warnings.go. Scans all task
 * configs for expressions referencing $context.env.* — a common authoring
 * mistake: environment variables are accessed via $env.*, and $context
 * holds accumulated exported task outputs, not environment variables.
 */
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";

import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

export function checkExpressionWarnings(
  spec: WorkflowSpec | undefined,
): string[] {
  if (spec === undefined || spec.tasks.length === 0) {
    return [];
  }

  const warnings: string[] = [];

  for (const task of spec.tasks) {
    if (task.taskConfig === undefined) {
      continue;
    }

    for (const envKey of findContextEnvRefs(task.taskConfig)) {
      warnings.push(
        `task '${task.name}': expression references '$context.env.${envKey}' which resolves to null. ` +
          `Environment variables are accessed via '$env.${envKey}', not '$context.env.${envKey}'. ` +
          "$context holds accumulated task outputs, not environment variables.",
      );
    }
  }

  return warnings;
}

/**
 * Scans a raw task config for strings containing "$context.env." and
 * returns the env key names referenced (e.g. "NOTIFICATION_DATE"). The
 * stubs surface Struct fields as plain JsonObject, so the walk is over
 * plain JSON — the same tree Go's structpb walk resolves.
 */
function findContextEnvRefs(s: JsonObject): string[] {
  const keys: string[] = [];
  for (const v of Object.values(s)) {
    keys.push(...findContextEnvRefsInValue(v));
  }
  return keys;
}

function findContextEnvRefsInValue(v: JsonValue): string[] {
  if (typeof v === "string") {
    return extractContextEnvKeys(v);
  }
  if (Array.isArray(v)) {
    const keys: string[] = [];
    for (const elem of v) {
      keys.push(...findContextEnvRefsInValue(elem));
    }
    return keys;
  }
  if (typeof v === "object" && v !== null) {
    return findContextEnvRefs(v);
  }
  return [];
}

/**
 * Extracts env key names from expressions like
 * "${ $context.env.NOTIFICATION_DATE }".
 */
function extractContextEnvKeys(s: string): string[] {
  const pattern = "$context.env.";
  const keys: string[] = [];

  for (;;) {
    const idx = s.indexOf(pattern);
    if (idx < 0) {
      break;
    }
    const rest = s.slice(idx + pattern.length);
    let keyEnd = 0;
    while (keyEnd < rest.length && isEnvKeyChar(rest.charCodeAt(keyEnd))) {
      keyEnd++;
    }
    if (keyEnd > 0) {
      keys.push(rest.slice(0, keyEnd));
    }
    s = rest.slice(keyEnd);
  }

  return keys;
}

function isEnvKeyChar(c: number): boolean {
  return (
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a) || // a-z
    (c >= 0x30 && c <= 0x39) || // 0-9
    c === 0x5f // _
  );
}
