// Memory RPC invocation for the remember tool — a 1:1 projection of
// MemoryCommandController.create (DD-005 D2: the tool layer adds no
// semantics; enablement, the caller gate, subject derivation, the 500-char
// contract, and the 100-record cap all live in the server's create path).
//
// The channels-domain calls.ts shape: build request, call, marshal. The
// answer is a single JSON payload serving both audiences at once:
//
//   { "outcome": "<honest one-liner for the model>", "memory": {…} }
//
// `outcome` is the DD-005 D2 relay — the fact was PROPOSED and awaits the
// user's decision, so the model never claims "I'll remember that". `memory`
// is the created record, verbatim proto JSON — the machine-checked contract
// the SDK's normalizeToolResult parses to render the consent chip (pinned
// in test/fixtures/tool-view/result-views.json).

import { create, toJson } from "@bufbuild/protobuf";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryCommandController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/command_pb";
import {
  MemoryProvenanceSchema,
  MemorySpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/memory/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { withClient } from "../client.js";
import type { CaptureContext } from "./context.js";

/**
 * The model-facing outcome line. Honest by design: the record starts
 * `proposed`, and only the user's confirm makes it recallable.
 */
export const PROPOSED_OUTCOME =
  "Proposed — the user decides. Nothing is remembered unless they confirm this fact.";

export async function proposeMemory(
  serverAddress: string,
  token: string,
  fact: string,
  context: CaptureContext,
): Promise<string> {
  const request = create(MemorySchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Memory",
    metadata: create(ApiResourceMetadataSchema, {
      // Org comes from the runner-threaded context, never from the model
      // (no org argument exists — the channels rule). Name stays empty:
      // memories are id-addressed and the server defaults the name.
      org: context.org,
    }),
    spec: create(MemorySpecSchema, {
      content: fact,
      // subject_identity_account_id is deliberately absent: the server
      // derives it from the calling credential (DD-005 D2) and ignores
      // any supplied value.
      provenance: create(MemoryProvenanceSchema, {
        agentId: context.agentId,
        sessionId: context.sessionId,
        agentExecutionId: context.agentExecutionId,
        // tool_call_id stays empty in v1 — MCP does not carry the
        // harness's tool-call identity to the tool handler.
      }),
    }),
  });

  return withClient(MemoryCommandController, serverAddress, token, async (client, opts) => {
    const created = await client.create(request, opts);
    const answer = {
      outcome: PROPOSED_OUTCOME,
      memory: toJson(MemorySchema, created, { useProtoFieldName: true }),
    };
    return JSON.stringify(answer, null, 2);
  });
}
