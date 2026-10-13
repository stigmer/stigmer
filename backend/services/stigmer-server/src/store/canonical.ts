/**
 * The canonical rendering of a typed message: SHA-256 over JSON whose keys
 * are sorted at every depth, for every fingerprint the platform stores (an
 * agent's version hash, pipeline/steps/spec-hash.ts; a resource's etag,
 * etag.ts). It lives under the store so the store can stamp a fingerprint
 * without importing the pipeline.
 *
 * The rendering is chosen so a hash moves only when the content does:
 *   - unset and default-valued fields are omitted (protobuf JSON's default),
 *     so adding a field to the message leaves every existing hash as it was;
 *   - object keys are sorted at every depth, so a map's insertion order (the
 *     env map, for one) never moves a hash;
 *   - enums are written as numbers, so renaming an enum value never moves a
 *     hash;
 *   - field names are the proto names, the wire identifiers that never
 *     change without a protocol break.
 * Binary encoding was rejected: map order and serialisation details are not
 * promised canonical across library versions, and a hash that moved on a
 * dependency bump would mint a version nobody wrote.
 *
 * Proven by pipeline/steps/__tests__/spec-hash.test.ts: stability across
 * map insertion order and an unset field, sensitivity to every content
 * change.
 */
import { createHash } from "node:crypto";
import { toJson } from "@bufbuild/protobuf";
import type { DescMessage, JsonValue, MessageShape } from "@bufbuild/protobuf";

/** SHA-256 (lowercase hex) of the canonical JSON rendering of `spec`. */
export function canonicalSpecHash<Desc extends DescMessage>(
  schema: Desc,
  spec: MessageShape<Desc>,
): string {
  const json = toJson(schema, spec, {
    enumAsInteger: true,
    useProtoFieldName: true,
  });
  return createHash("sha256").update(canonicalJson(json)).digest("hex");
}

/** JSON text with object keys sorted at every depth; arrays keep their order. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const members = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`,
    );
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}
