// The canonical form of an OpenFGA authorization model in JSON: the one
// rendering every producer of the model agrees on, so two renderings can be
// compared byte for byte.
//
// OpenFGA's model is a protobuf message, and its producers render it as
// proto3 JSON with different habits about unpopulated fields: the
// JavaScript parser emits empty lists (`"directly_related_user_types": []`)
// and an empty `conditions` map, OpenFGA's own read-back emits empty
// strings and nulls, and the Go CLI's `fga model transform` emits none of
// them. proto3 JSON itself says an unpopulated field is omitted, so the
// canonical form omits them all:
//
//   - an empty string, a null, and an empty list are dropped;
//   - an empty MAP is dropped (the model's map fields: the top-level
//     `conditions`, a type's `relations`, its metadata's `relations`, and
//     a condition's `parameters`), decided by the field a value sits in,
//     never by a map's own keys, which are data;
//   - an empty MESSAGE is kept: `"this": {}` is a set oneof that means
//     "the relation's direct tuples", and a relation's metadata `{}` says
//     it lists no direct types. Dropping either would change the model.
//
// Keys are sorted at every level, and arrays keep their order (a union's
// children are evaluated in order). The committed file is this form,
// pretty-printed with two spaces and a trailing newline, so a model change
// reads as a line diff; a comparison with another producer minifies both
// sides in this form. The rule is stated once for readers in
// backend/services/stigmer-server/fga/model/README.md.
//
// The parser's result is typed `any` under `skipLibCheck` (its declaration
// names a package it does not depend on), so this takes `unknown` and
// trusts nothing about its shape beyond being JSON.

/** A JSON value as `JSON.parse` returns it. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The model's map-valued fields: dropped when empty, where an empty message is kept. */
const MAP_FIELDS: ReadonlySet<string> = new Set(["conditions", "relations", "parameters"]);

/** The canonical form of a model, or of any JSON value in it. */
export function canonicalize(value: unknown): Json {
  const canonical = canonicalValue(value, "$");
  if (canonical === undefined) {
    throw new Error("canonicalize: the model is empty");
  }
  return canonical;
}

/** The committed rendering: canonical, two-space indentation, trailing newline. */
export function formatCanonical(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

/** The comparison rendering: canonical and minified. */
export function minifyCanonical(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * The canonical value, or undefined when proto3 JSON would omit it.
 * `field` is the message field `value` sits in, and undefined for a list
 * element or a map entry's value: a map's own keys are data (a relation
 * may be named anything), so only a field name decides what is a map.
 */
function canonicalValue(value: unknown, path: string, field?: string): Json | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalize: ${path} is not a finite number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined;
    }
    return value.map((element, index) => {
      const canonical = canonicalValue(element, `${path}[${index}]`);
      if (canonical === undefined) {
        throw new Error(`canonicalize: ${path}[${index}] is an unpopulated list element`);
      }
      return canonical;
    });
  }
  if (typeof value === "object") {
    const isMap = field !== undefined && MAP_FIELDS.has(field);
    const out: { [key: string]: Json } = {};
    for (const name of Object.keys(value).sort()) {
      const canonical = canonicalValue(
        (value as Record<string, unknown>)[name],
        `${path}.${name}`,
        isMap ? undefined : name,
      );
      if (canonical !== undefined) {
        out[name] = canonical;
      }
    }
    if (isMap && Object.keys(out).length === 0) {
      return undefined;
    }
    return out;
  }
  throw new Error(`canonicalize: ${path} is a ${typeof value}, not JSON`);
}
