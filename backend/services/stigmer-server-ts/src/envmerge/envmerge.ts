/**
 * Environment layer merging — ports backend/libs/go/envmerge/merge.go.
 * Consumed by the agentexecution execution-context builder (#17) and,
 * with #20, the workflowexecution equivalent. Lives inside the server per
 * the ratified shared-library posture (extraction to backend/libs/ts/
 * only on a second SERVICE consumer — the temporal-codecs precedent).
 */
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { create } from "@bufbuild/protobuf";

/**
 * Merges two layers of environment configuration into a single map of
 * ExecutionValue entries, suitable for persisting in an ExecutionContext.
 *
 * Merge priority (lowest to highest):
 *  1. environments — resolved Environment resources from instance
 *     environment_refs (in order; later overrides earlier; empty values
 *     skipped)
 *  2. runtimeEnv — execution-scoped runtime_env overrides
 */
export function mergeEnvironmentLayers(
  environments: Environment[],
  runtimeEnv: { [key: string]: ExecutionValue },
): Map<string, ExecutionValue> {
  const merged = new Map<string, ExecutionValue>();

  for (const env of environments) {
    // Go skips nil slice elements; the defensive twin for a hole smuggled
    // past the type system (Go merge_test.go pins this).
    if (env === undefined) {
      continue;
    }
    for (const [key, ev] of Object.entries(env.spec?.data ?? {})) {
      if (ev.value === "") {
        continue;
      }
      merged.set(
        key,
        create(ExecutionValueSchema, {
          value: ev.value,
          isSecret: ev.isSecret,
        }),
      );
    }
  }

  for (const [key, ev] of Object.entries(runtimeEnv)) {
    // Go skips nil entries; the TS analogue is an explicitly-undefined
    // value in the record.
    if (ev === undefined) {
      continue;
    }
    merged.set(key, ev);
  }

  return merged;
}

/**
 * Restricts a merged environment map to only the keys declared in the
 * blueprint's env field (least-privilege): a blueprint only receives the
 * variables it explicitly declared, even if the linked environments carry
 * additional secrets. Empty declarations return the merged map unchanged
 * (backward compatibility for blueprints declaring no env vars). Returns
 * the filtered map and a sorted list of excluded keys for observability.
 */
export function filterByDeclaredKeys(
  merged: Map<string, ExecutionValue>,
  declarations: { [key: string]: EnvVarDeclaration },
): { filtered: Map<string, ExecutionValue>; excludedKeys: string[] } {
  const declared = Object.keys(declarations);
  if (declared.length === 0) {
    return { filtered: merged, excludedKeys: [] };
  }

  const filtered = new Map<string, ExecutionValue>();
  const excludedKeys: string[] = [];
  for (const [key, val] of merged) {
    if (key in declarations) {
      filtered.set(key, val);
    } else {
      excludedKeys.push(key);
    }
  }
  excludedKeys.sort();
  return { filtered, excludedKeys };
}

/**
 * Checks that every required (non-optional) declared key has an entry in
 * the filtered map; returns the sorted missing keys (empty = passed).
 */
export function validateRequiredKeys(
  filtered: Map<string, ExecutionValue>,
  declarations: { [key: string]: EnvVarDeclaration },
): string[] {
  const missingRequired: string[] = [];
  for (const [key, decl] of Object.entries(declarations)) {
    if (decl.optional) {
      continue;
    }
    if (!filtered.has(key)) {
      missingRequired.push(key);
    }
  }
  missingRequired.sort();
  return missingRequired;
}
