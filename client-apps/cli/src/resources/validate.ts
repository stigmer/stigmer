// Offline resource validation: parse a YAML document into its proto schema.
//
// protobuf-es `fromJson` performs structural validation — field types, required
// shapes, and enum membership — without a server round-trip, mirroring the Go
// CLI's local load-and-validate. The accepted kinds are the file-based verbs
// (apply/validate) that carry a YAML representation.

import { type DescMessage, fromJson, type JsonValue } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { mcpServerWayForward } from "@stigmer/sdk";

// Exported for the verb/dispatch conformance suite (registry/registry.test.ts),
// which holds this map and the matrix's Verb.Validate promises to strict
// bidirectional equality — the stigmer/stigmer#353 drift class. Command code
// resolves schemas through `schemaForValidate`, never this map directly.
export const VALIDATE_SCHEMAS: ReadonlyMap<ApiResourceKind, DescMessage> = new Map<ApiResourceKind, DescMessage>([
  [ApiResourceKind.agent, AgentSchema],
]);

export function schemaForValidate(kind: ApiResourceKind): DescMessage | undefined {
  return VALIDATE_SCHEMAS.get(kind);
}

/** Structurally validate a parsed YAML document against its proto schema. */
export function validateDocument(schema: DescMessage, document: JsonValue): void {
  // A retired field is not a forward-compat one: the leniency below would
  // pass an agent listing mcp_server_usages that apply then refuses, so it
  // is refused here with the same way forward.
  const retired = mcpServerWayForward(document);
  if (retired !== undefined) throw new Error(`mcp_server_usages is no longer read. ${retired}`);
  // ignoreUnknownFields mirrors the server's lenient unmarshal: forward-compat
  // fields a newer server adds should not fail a slightly older CLI.
  fromJson(schema, document, { ignoreUnknownFields: true });
}
