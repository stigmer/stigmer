/**
 * Strict reads of a parsed JSON or YAML value, for the two inputs the
 * authorization module takes as data: the compiled model
 * (model/openfga-json.ts) and the `.fga.yaml` store tests the evaluator is
 * proven against (__tests__/store-test-kit.ts). Both are written by a
 * format this module does not own (OpenFGA's), so both are read as
 * `unknown` and refused loudly on anything unexpected: a change upstream
 * is a thrown fault naming where it failed, never a half-read input.
 *
 * Every function takes `where`, the path of the value in its document
 * (`authorization-model.json: type_definitions[3].relations.viewer`), and
 * puts it at the head of the message.
 */

/** A mapping, refusing any key outside `allowedKeys` when they are given. */
export function record(
  value: unknown,
  where: string,
  allowedKeys?: ReadonlyArray<string>,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}: expected a mapping`);
  }
  const entry = value as Record<string, unknown>;
  if (allowedKeys !== undefined) {
    for (const key of Object.keys(entry)) {
      if (!allowedKeys.includes(key)) {
        throw new Error(`${where}: unknown key '${key}'`);
      }
    }
  }
  return entry;
}

export function list(value: unknown, where: string): ReadonlyArray<unknown> {
  if (!Array.isArray(value)) {
    throw new Error(`${where}: expected a list`);
  }
  return value as ReadonlyArray<unknown>;
}

/** A list, or the empty list when the key is absent. */
export function optionalList(value: unknown, where: string): ReadonlyArray<unknown> {
  return value === undefined ? [] : list(value, where);
}

export function text(value: unknown, where: string): string {
  if (typeof value !== "string") {
    throw new Error(`${where}: expected a string`);
  }
  return value;
}
