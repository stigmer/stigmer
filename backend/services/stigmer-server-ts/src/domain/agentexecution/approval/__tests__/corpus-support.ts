/**
 * Shared-corpus test support — the TS-server edition of Go's
 * corpus_path_test.go + fixtures_test.go decode helpers. Locates the
 * cross-edition HITL corpus (apis/testdata/hitl) through this file's
 * compiled-in source path, decodes raw protojson bodies with the
 * generated schemas (a malformed fixture fails loudly, never silently
 * skips), and diffs pending-approval sets order-independently by
 * tool_call_id.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { equals, fromJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";

import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";

/**
 * The corpus root: this file lives at
 * backend/services/stigmer-server-ts/src/domain/agentexecution/approval/__tests__/,
 * eight directories above which is the repo root; the corpus lives under
 * apis/testdata/hitl.
 */
export function hitlCorpusDir(): string {
  return path.join(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../../../../../../..",
    "apis/testdata/hitl",
  );
}

/** The corpus .json files of a subdirectory, schema.json excluded. */
export function corpusFiles(subdir: string): string[] {
  const dir = path.join(hitlCorpusDir(), subdir);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && name !== "schema.json")
    .map((name) => path.join(dir, name));
}

export function readCorpusJson(filePath: string): JsonValue {
  return JSON.parse(readFileSync(filePath, "utf-8")) as JsonValue;
}

export function decodeMessages(raws: JsonValue[] | undefined): AgentMessage[] {
  return (raws ?? []).map((raw) => fromJson(AgentMessageSchema, raw));
}

export function decodeSubAgents(
  raws: JsonValue[] | undefined,
): SubAgentExecution[] {
  return (raws ?? []).map((raw) => fromJson(SubAgentExecutionSchema, raw));
}

export function decodePendingApprovals(
  raws: JsonValue[] | undefined,
): PendingApproval[] {
  const out = (raws ?? []).map((raw) => fromJson(PendingApprovalSchema, raw));
  out.sort((a, b) => (a.toolCallId < b.toolCallId ? -1 : 1));
  return out;
}

/**
 * Order-independent diff by tool_call_id (the test-side twin of the
 * production seam's cross-check diff); "" when semantically equal.
 */
export function diffPendingApprovals(
  want: PendingApproval[],
  got: PendingApproval[],
): string {
  const wantById = new Map(want.map((pa) => [pa.toolCallId, pa]));
  const gotById = new Map(got.map((pa) => [pa.toolCallId, pa]));
  if (wantById.size !== want.length || gotById.size !== got.length) {
    return "duplicate tool_call_id within a projection set";
  }

  const diffs: string[] = [];
  for (const [id, pa] of wantById) {
    const other = gotById.get(id);
    if (other === undefined) {
      diffs.push(`missing:${id}`);
      continue;
    }
    if (!equals(PendingApprovalSchema, pa, other)) {
      diffs.push(`field-mismatch:${id}`);
    }
  }
  for (const id of gotById.keys()) {
    if (!wantById.has(id)) {
      diffs.push(`unexpected:${id}`);
    }
  }
  diffs.sort();
  return diffs.join(",");
}
