// Offline resource validation: parse a YAML document into its proto schema.
//
// protobuf-es `fromJson` performs structural validation — field types, required
// shapes, and enum membership — without a server round-trip, mirroring the Go
// CLI's local load-and-validate. The accepted kinds are the file-based verbs
// (apply/validate) that carry a YAML representation.

import { type DescMessage, fromJson, type JsonValue } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { DatastoreSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";

// Exported for the verb/dispatch conformance suite (registry/registry.test.ts),
// which holds this map and the matrix's Verb.Validate promises to strict
// bidirectional equality — the stigmer/stigmer#353 drift class. Command code
// resolves schemas through `schemaForValidate`, never this map directly.
export const VALIDATE_SCHEMAS: ReadonlyMap<ApiResourceKind, DescMessage> = new Map<ApiResourceKind, DescMessage>([
  [ApiResourceKind.agent, AgentSchema],
  [ApiResourceKind.workflow, WorkflowSchema],
  [ApiResourceKind.mcp_server, McpServerSchema],
  [ApiResourceKind.project, ProjectSchema],
  [ApiResourceKind.datastore, DatastoreSchema],
]);

export function schemaForValidate(kind: ApiResourceKind): DescMessage | undefined {
  return VALIDATE_SCHEMAS.get(kind);
}

/** Structurally validate a parsed YAML document against its proto schema. */
export function validateDocument(schema: DescMessage, document: JsonValue): void {
  // ignoreUnknownFields mirrors the server's lenient unmarshal: forward-compat
  // fields a newer server adds should not fail a slightly older CLI.
  fromJson(schema, document, { ignoreUnknownFields: true });
}
