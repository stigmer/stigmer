/**
 * The update mask (AIP-134): an update changes only the fields its
 * `update_mask` names, and every other field keeps its stored value.
 *
 * Paths are proto field names joined by dots (`spec.instructions`,
 * `metadata.labels`). An update may name:
 *   - `spec`, or any field under it, at any depth through message fields;
 *   - `metadata.name`, `metadata.labels` and `metadata.tags`;
 *   - `*`, every one of those.
 * A list or map at a named path is replaced whole; a path never goes
 * through one. A path that names nothing on the kind, an empty mask, and a
 * path into a field another door owns or the server writes (each kind
 * declares those beside its chain, `RefusedUpdatePath`) is refused with
 * INVALID_ARGUMENT naming the path. A refused field under a broader path
 * (`spec`, `*`) is not refused: it keeps its stored value, as the kinds'
 * keep steps keep it, so a whole desired state (apply) still applies.
 *
 * `metadata.version.message` and `metadata.version.tag` are per-save
 * arguments, not stored state a mask selects: an update takes them
 * whenever the request sets them.
 *
 * Pinned by __tests__/update-mask.test.ts.
 */
import { clone, create } from "@bufbuild/protobuf";
import type { DescField, DescMessage, Message } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";

import { invalidArgumentError } from "../errors.js";

/** The context key an update chain's mask rides, set by the handler that unwraps the request. */
export const UPDATE_MASK_KEY = "updateMask";

/** The path that names every field an update may change. */
export const EVERY_UPDATABLE_PATH = "*";

/** The metadata fields an update may name; the rest of metadata is the server's or another door's. */
export const UPDATABLE_METADATA_PATHS: ReadonlyArray<string> = [
  "metadata.name",
  "metadata.labels",
  "metadata.tags",
];

/** A field an update may not name, and the door that writes it (the refusal's words). */
export interface RefusedUpdatePath {
  readonly path: string;
  /** Who writes it instead, as a client reads it: "setSecrets", "rotateSecret", "the server". */
  readonly writtenBy: string;
}

/** The paths an update names, from its handler; `*` when the chain was reached without one (apply). */
export function updateMaskOf(get: (key: string) => unknown): ReadonlyArray<string> {
  const paths = get(UPDATE_MASK_KEY);
  return Array.isArray(paths) ? (paths as string[]) : [EVERY_UPDATABLE_PATH];
}

/**
 * Refuses a mask that names nothing, a path the kind does not have, a path
 * into a list or map, and a path into a refused field; answers the paths to
 * copy, with `*` expanded.
 */
export function checkUpdateMask(
  schema: DescMessage,
  paths: ReadonlyArray<string>,
  refused: ReadonlyArray<RefusedUpdatePath>,
): ReadonlyArray<string> {
  if (paths.length === 0) {
    throw invalidArgumentError("update_mask names no path: name the fields the update changes, or \"*\"");
  }
  const expanded: string[] = [];
  for (const path of paths) {
    if (path === EVERY_UPDATABLE_PATH) {
      expanded.push("spec", ...UPDATABLE_METADATA_PATHS);
      continue;
    }
    if (!(path === "spec" || path.startsWith("spec.") || UPDATABLE_METADATA_PATHS.includes(path))) {
      throw invalidArgumentError(
        `update_mask path '${path}' cannot be updated: an update changes spec, metadata.name, metadata.labels and metadata.tags`,
      );
    }
    if (fieldsAlong(schema, path) === undefined) {
      throw invalidArgumentError(`update_mask path '${path}' is not a field of ${schema.name}`);
    }
    const owned = refused.find(
      (entry) => path === entry.path || path.startsWith(`${entry.path}.`),
    );
    if (owned !== undefined) {
      throw invalidArgumentError(
        `update_mask path '${path}' is written by ${owned.writtenBy}, not by update`,
      );
    }
    expanded.push(path);
  }
  return expanded;
}

/**
 * Copies every path from `request` onto `merged` (both of `schema`): a set
 * field is copied, an unset one is cleared. A refused field under a copied
 * path is put back from `stored`, so it keeps its stored value. The paths
 * are ones checkUpdateMask admitted and the kind's refused paths, each a
 * field of the kind (docs/update-paths.md's test proves the refused ones).
 */
export function applyUpdateMask<M extends Message>(
  schema: DescMessage,
  merged: M,
  request: M,
  stored: M,
  paths: ReadonlyArray<string>,
  refused: ReadonlyArray<RefusedUpdatePath>,
): void {
  const source = clone(schema, request);
  for (const path of paths) {
    copyPath(reflect(schema, source), reflect(schema, merged), fieldsAlong(schema, path) as PathFields);
  }
  for (const entry of refused) {
    if (paths.some((path) => entry.path.startsWith(`${path}.`))) {
      copyPath(reflect(schema, clone(schema, stored)), reflect(schema, merged), fieldsAlong(schema, entry.path) as PathFields);
    }
  }
}

/** A message field a path goes through. */
type MessageField = Extract<DescField, { fieldKind: "message" }>;

/** The fields a path names: the message fields it goes through, then the one it names. */
interface PathFields {
  readonly through: ReadonlyArray<MessageField>;
  readonly last: DescField;
}

/** The fields a path names; undefined when a segment is no field or goes through a list or map. */
function fieldsAlong(schema: DescMessage, path: string): PathFields | undefined {
  const segments = path.split(".");
  const through: MessageField[] = [];
  let current: DescMessage = schema;
  for (const segment of segments.slice(0, -1)) {
    const field = current.fields.find((candidate) => candidate.name === segment);
    if (field === undefined || field.fieldKind !== "message") {
      return undefined;
    }
    through.push(field);
    current = field.message;
  }
  const last = current.fields.find((candidate) => candidate.name === segments[segments.length - 1]);
  return last === undefined ? undefined : { through, last };
}

/**
 * Copies one path from `source` onto `target`. A set field creates the
 * messages it goes through; a cleared one creates none, so clearing a field
 * under a message the target lacks leaves the target as it was.
 */
function copyPath(source: ReflectMessage, target: ReflectMessage, { through, last }: PathFields): void {
  const from = messageAlong(source, through);
  if (from === undefined || !from.isSet(last)) {
    messageAlong(target, through)?.clear(last);
    return;
  }
  let to = target;
  for (const field of through) {
    if (!to.isSet(field)) {
      to.set(field, reflect(field.message, create(field.message)));
    }
    to = to.get(field) as ReflectMessage;
  }
  to.set(last, from.get(last));
}

/** The message `through` reaches from `message`; undefined when one along the way is unset. */
function messageAlong(message: ReflectMessage, through: ReadonlyArray<MessageField>): ReflectMessage | undefined {
  let at = message;
  for (const field of through) {
    if (!at.isSet(field)) {
      return undefined;
    }
    at = at.get(field) as ReflectMessage;
  }
  return at;
}
