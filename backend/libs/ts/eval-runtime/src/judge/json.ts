/**
 * The JSON shapes the judge's schema and verdict are written in: a judge
 * run's structured output is plain JSON, and this library depends on no
 * other package, so it names the shape itself. Structurally the same as
 * `@bufbuild/protobuf`'s `JsonValue` and `JsonObject`, so the server and the
 * runner pass their values through without a conversion.
 */

/** Any JSON value. */
export type JsonValue =
  | number
  | string
  | boolean
  | null
  | JsonObject
  | JsonValue[];

/** A JSON object. */
export type JsonObject = { [key: string]: JsonValue };
