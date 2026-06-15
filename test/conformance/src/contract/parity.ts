// Field-ignoring resource comparison for the conformance contract.
// Domain: conformance contract.
//
// Round-trip and cross-target parity must ignore fields that are legitimately
// non-deterministic or server-owned: the generated id, version records, and the
// entire status block (audit actors/timestamps, reconciliation summaries). What
// remains — api_version, kind, spec, and client-owned metadata — is the part of
// a resource the contract actually guarantees.
import { toJson, type DescMessage, type JsonValue, type MessageShape } from "@bufbuild/protobuf";
import { expect } from "vitest";

export const DEFAULT_IGNORED_PATHS = ["metadata.id", "metadata.version", "status"];

export function assertResourceParity<Desc extends DescMessage>(
  schema: Desc,
  expected: MessageShape<Desc>,
  actual: MessageShape<Desc>,
  context: string,
  ignoredPaths: string[] = DEFAULT_IGNORED_PATHS,
): void {
  const normalizedExpected = stripPaths(toJson(schema, expected), ignoredPaths);
  const normalizedActual = stripPaths(toJson(schema, actual), ignoredPaths);
  expect(normalizedActual, `${context}: resource parity mismatch`).toEqual(normalizedExpected);
}

function stripPaths(value: JsonValue, paths: string[]): JsonValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const clone = structuredClone(value) as Record<string, JsonValue>;
  for (const path of paths) {
    deleteAtPath(clone, path.split("."));
  }
  return clone;
}

function deleteAtPath(root: Record<string, JsonValue>, segments: string[]): void {
  let cursor: Record<string, JsonValue> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cursor[segments[i] as string];
    if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    cursor = next as Record<string, JsonValue>;
  }
  delete cursor[segments[segments.length - 1] as string];
}
