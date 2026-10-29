/**
 * Decodes the run status JSON that crosses Temporal: strictly, with one
 * tolerance, a field name its message reserves is dropped.
 *
 * An activity's input is recorded when the workflow schedules it, so a
 * status write in flight across a deploy (a retry of the workflow's own
 * write) is decoded by the release after the one that wrote it. A release
 * that removes a field reserves its name, and such a write still carries
 * it: the field is dropped, under its proto or its JSON name, in the
 * status and in every message nested in it, as its data left the contract
 * with it. Any other unknown name, of a field or of an enum value, is
 * refused, so a status update stays strict.
 */
import {
  fromJson,
  type DescField,
  type DescMessage,
  type JsonObject,
  type JsonValue,
  type MessageShape,
} from "@bufbuild/protobuf";

/** A status update's payload: reserved names dropped, anything else unknown refused. */
export function decodeRunStatusJson<Desc extends DescMessage>(
  schema: Desc,
  raw: JsonValue,
): MessageShape<Desc> {
  return fromJson(schema, withoutReserved(raw, schema));
}

/** A message's JSON without the field names it reserves, guided by the schema. */
function withoutReserved(value: JsonValue, desc: DescMessage): JsonValue {
  if (!isJsonObject(value) || desc.typeName.startsWith("google.protobuf.")) {
    return value;
  }
  const reserved = reservedNamesOf(desc);
  const out: JsonObject = {};
  for (const [key, raw] of Object.entries(value)) {
    if (reserved.has(key)) {
      continue;
    }
    const field = desc.fields.find((f) => f.jsonName === key || f.name === key);
    out[key] = field === undefined || raw === undefined ? raw : fieldWithoutReserved(raw, field);
  }
  return out;
}

/** The field names a message reserves, as proto names and as JSON names. */
function reservedNamesOf(desc: DescMessage): ReadonlySet<string> {
  const names = new Set<string>();
  for (const name of desc.proto.reservedName) {
    names.add(name);
    names.add(name.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase()));
  }
  return names;
}

/** One field's value, or each element of a list or map field; only a message is walked. */
function fieldWithoutReserved(raw: JsonValue, field: DescField): JsonValue {
  const message = field.message;
  if (message === undefined) {
    return raw;
  }
  if (field.fieldKind === "list" && Array.isArray(raw)) {
    return raw.map((item) => withoutReserved(item, message));
  }
  if (field.fieldKind === "map" && isJsonObject(raw)) {
    return Object.fromEntries(
      Object.entries(raw).map(([key, item]) => [key, withoutReserved(item, message)]),
    );
  }
  return withoutReserved(raw, message);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
