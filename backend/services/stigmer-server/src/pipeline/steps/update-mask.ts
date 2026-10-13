/**
 * The update mask (AIP-134): an update changes only the fields its
 * `update_mask` names, and every other field keeps its stored value.
 *
 * Paths are proto field names joined by dots (`spec.instructions`,
 * `metadata.labels`). An update may name:
 *   - `spec`, or any field under it, at any depth through message fields;
 *   - `metadata.name`, `metadata.labels`, `metadata.tags` and
 *     `metadata.annotations`;
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
  "metadata.annotations",
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
        `update_mask path '${path}' cannot be updated: an update changes spec, metadata.name, metadata.labels, metadata.tags and metadata.annotations`,
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
 * path is put back from `stored`, so it keeps its stored value.
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
    copyPath(reflect(schema, source), reflect(schema, merged), path.split("."));
  }
  for (const entry of refused) {
    if (paths.some((path) => entry.path.startsWith(`${path}.`))) {
      copyPath(reflect(schema, clone(schema, stored)), reflect(schema, merged), entry.path.split("."));
    }
  }
}

/** The fields a path names, outermost first; undefined when a segment is no field or goes through a list or map. */
function fieldsAlong(schema: DescMessage, path: string): DescField[] | undefined {
  const fields: DescField[] = [];
  let current: DescMessage | undefined = schema;
  const segments = path.split(".");
  for (const [index, segment] of segments.entries()) {
    const field: DescField | undefined = current?.fields.find((candidate) => candidate.name === segment);
    if (field === undefined) {
      return undefined;
    }
    fields.push(field);
    const last = index === segments.length - 1;
    if (!last) {
      if (field.fieldKind !== "message") {
        return undefined;
      }
      current = field.message;
    }
  }
  return fields;
}

function copyPath(source: ReflectMessage, target: ReflectMessage, segments: string[]): void {
  const [segment, ...rest] = segments;
  const field = source.desc.fields.find((candidate) => candidate.name === segment);
  if (field === undefined) {
    return;
  }
  if (rest.length === 0) {
    if (source.isSet(field)) {
      target.set(field, source.get(field));
    } else {
      target.clear(field);
    }
    return;
  }
  if (field.fieldKind !== "message") {
    return;
  }
  if (!target.isSet(field)) {
    target.set(field, reflect(field.message, create(field.message)));
  }
  const sourceChild = source.isSet(field)
    ? (source.get(field) as ReflectMessage)
    : reflect(field.message, create(field.message));
  copyPath(sourceChild, target.get(field) as ReflectMessage, rest);
}
