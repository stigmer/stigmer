// Canonical protobuf → JSON serialization shared by every tool response.
//
// The contract: protojson with proto field names and no unpopulated fields,
// 2-space indented. protobuf-es `toJson` with { useProtoFieldName: true } gives
// exactly that —
// snake_case field names, omitted defaults, base64 bytes, string enums, and
// RFC-3339 timestamps — and JSON.stringify(..., 2) applies the same indentation.

import { toJson, type DescMessage, type MessageShape } from "@bufbuild/protobuf";

/**
 * Serialize a protobuf message to the human-friendly JSON string returned in
 * MCP tool output. Field names use the proto (snake_case) names so the payload
 * is byte-comparable, after parsing, with the CLI's `-o json`.
 */
export function toProtoJson<Desc extends DescMessage>(
  schema: Desc,
  message: MessageShape<Desc>,
): string {
  return JSON.stringify(toJson(schema, message, { useProtoFieldName: true }), null, 2);
}
