// Canonical protobuf -> JSON/YAML rendering for read verbs.
//
// Parity contract (mirrors Go pkg/display/proto.go and mcp-server marshal.ts):
// the Go CLI emits protojson with UseProtoNames=true and EmitUnpopulated=false,
// 2-space indented. protobuf-es `toJson` with { useProtoFieldName: true }
// reproduces that exactly — snake_case fields, omitted defaults, base64 bytes,
// string enums, RFC-3339 timestamps — and the YAML path round-trips through the
// same JSON value so field naming stays identical.

import { type DescMessage, type JsonValue, type MessageShape, toJson } from "@bufbuild/protobuf";
import { stringify as toYaml } from "yaml";

const JSON_WRITE_OPTIONS = { useProtoFieldName: true } as const;

/** Proto -> protojson JsonValue (snake_case fields, omitted defaults). */
export function protoToJsonValue<Desc extends DescMessage>(
  schema: Desc,
  message: MessageShape<Desc>,
): JsonValue {
  return toJson(schema, message, JSON_WRITE_OPTIONS);
}

/** Render a single proto message as pretty JSON, newline-terminated. */
export function renderProtoJson<Desc extends DescMessage>(
  schema: Desc,
  message: MessageShape<Desc>,
): string {
  return JSON.stringify(protoToJsonValue(schema, message), null, 2) + "\n";
}

/** Render a single proto message as YAML. */
export function renderProtoYaml<Desc extends DescMessage>(
  schema: Desc,
  message: MessageShape<Desc>,
): string {
  return toYaml(protoToJsonValue(schema, message));
}

/** Render a list of proto messages as a pretty JSON array, newline-terminated. */
export function renderProtoListJson<Desc extends DescMessage>(
  schema: Desc,
  messages: readonly MessageShape<Desc>[],
): string {
  const array = messages.map((message) => protoToJsonValue(schema, message));
  return JSON.stringify(array, null, 2) + "\n";
}

/** Render a list of proto messages as a YAML array. */
export function renderProtoListYaml<Desc extends DescMessage>(
  schema: Desc,
  messages: readonly MessageShape<Desc>[],
): string {
  const array = messages.map((message) => protoToJsonValue(schema, message));
  return toYaml(array);
}
