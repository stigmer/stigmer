/**
 * The runner-synthesized datastore records attachment (T05, DD-001 SD-2).
 *
 * When an agent declares `datastore_usages`, the runner synthesizes ONE
 * MCP attachment serving the five record tools (DD-005) — the agent
 * builder writes a usage line and gets tools; no McpServer resource, no
 * Environment, no credential in any manifest. Harness-agnostic like
 * mcp-resolver.ts: both ExecuteCursor and ExecuteDeepAgent inject the
 * synthesized entry through their existing ResolvedMcpServer paths.
 *
 * Two connection shapes, one roster (the bridge's records-only roster,
 * T05 R1):
 *   - Bridge endpoint configured (cloud): Streamable HTTP against the
 *     bridge's /records route, with the execution's own session-scoped
 *     credential as the Bearer token — the server's reach chain (DD-006
 *     Path 1) authorizes from that token; the bridge stays a
 *     non-validating passthrough.
 *   - No bridge endpoint (OSS/local): a spawned `stigmer mcp-server`
 *     stdio child with STIGMER_MCP_ROSTER=records against the local
 *     backend (zero new distribution — the CLI already embeds the
 *     bridge). No credential: the local backend is unauthenticated and
 *     OSS callers resolve as the local principal (T05 R2).
 *
 * Approval-free by construction (DD-001 SD-3): empty toolApprovals +
 * pinnedToolApprovals + toolApprovalOverrides mean mergeApprovalPolicies
 * emits no entries for this server — zero classifier involvement, and no
 * proto surface can target it (the attachment has no McpServerUsage, and
 * since issue #349 an agent's overrides are scoped to their own usage's
 * server, so a same-named override elsewhere cannot reach this one).
 * `discoveredCapabilitiesEmpty`
 * is false and the attachment has no McpServerUsage, so the connect
 * backfill (whose destructiveHint tightener would force-gate
 * delete_record — silently skipped on channels under UNATTENDED mode)
 * is structurally unable to touch it. Callers must still inject AFTER
 * resolve + backfill; both harness call sites do.
 */

import type { DatastoreUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { ResolvedMcpServer } from "./mcp-resolver.js";
import { grpcTarget, type SynthesizedAttachmentOptions } from "./synthesized-attachment.js";

/**
 * The synthesized attachment's slug. Reserved: a user McpServer with
 * this slug is shadowed by the synthesized attachment (the record tools
 * must exist whenever `datastore_usages` says so), with a warning.
 */
export const DATASTORE_ATTACHMENT_SLUG = "stigmer-records";

/** The bridge route serving the records-only roster (mcp-server T05 R1). */
export const RECORDS_ROUTE = "/records";

/**
 * Synthesize the records attachment for an agent's datastore usages.
 * Returns undefined when the agent uses no datastores — the attachment
 * exists exactly when the usage edge does.
 */
export function synthesizeDatastoreAttachment(
  datastoreUsages: DatastoreUsage[],
  options: SynthesizedAttachmentOptions,
): ResolvedMcpServer | undefined {
  if (datastoreUsages.length === 0) {
    return undefined;
  }

  // Approval-free by construction + backfill-proof: see file header.
  const base = {
    slug: DATASTORE_ATTACHMENT_SLUG,
    toolApprovals: [],
    pinnedToolApprovals: [],
    toolApprovalOverrides: [],
    discoveredCapabilitiesEmpty: false,
  };

  if (options.bridgeEndpoint !== null && options.bridgeEndpoint !== "") {
    return {
      ...base,
      connectionType: "http",
      url: options.bridgeEndpoint.replace(/\/+$/, "") + RECORDS_ROUTE,
      headers: options.credential !== null && options.credential !== ""
        ? { Authorization: `Bearer ${options.credential}` }
        : undefined,
    };
  }

  return {
    ...base,
    connectionType: "stdio",
    command: "stigmer",
    args: ["mcp-server"],
    env: {
      STIGMER_MCP_ROSTER: "records",
      STIGMER_SERVER_ADDRESS: grpcTarget(options.backendEndpoint),
    },
  };
}

/**
 * The five record tools the records roster always serves (DD-005; the
 * mcp-server's records roster registers all five unconditionally for the
 * agent audience — only the `org` argument shape varies by audience, see
 * mcp-server/src/domains/records/tools.ts). Because the roster never
 * legitimately narrows, any of these missing from the connected toolset
 * means the store is degraded (issue #325) — the prompt section and the
 * reconciliation both derive from this one list so they cannot drift.
 */
export const EXPECTED_RECORD_TOOLS = [
  "describe_datastore",
  "find_records",
  "insert_record",
  "update_record",
  "delete_record",
] as const;

/**
 * Reconcile the record tools actually connected against the roster
 * contract (issue #325). Returns the expected tools absent from
 * `actualToolNames` — empty means healthy. Names are bare tool names
 * exactly as reported by tools/list (the mcp-enabled-tools identity
 * space); extraneous names are ignored.
 */
export function missingRecordTools(actualToolNames: Iterable<string>): string[] {
  const present = new Set(actualToolNames);
  return EXPECTED_RECORD_TOOLS.filter((name) => !present.has(name));
}

/**
 * The operator-facing degradation notice (issue #325): pushed as a
 * MESSAGE_SYSTEM row on the execution status so "declared N datastores,
 * X/5 record tools connected" is visible without reading a transcript.
 * Lives HERE with the rest of the datastore-attachment wording — the
 * harness only threads it.
 */
export function formatDatastoreDegradationNotice(
  declaredCount: number,
  missing: readonly string[],
): string {
  const connected = EXPECTED_RECORD_TOOLS.length - missing.length;
  return (
    `Datastore record tools unavailable this turn: declared ` +
    `${declaredCount} datastore(s), ${connected}/${EXPECTED_RECORD_TOOLS.length} ` +
    `record tools connected (missing: ${missing.join(", ")}). The agent has ` +
    `been instructed to disclose this instead of answering from memory.`
  );
}

/**
 * The datastores prompt section (DD-005 SD-5, the skills-section
 * precedent). Shared by both harnesses so the section text cannot drift
 * (the sender-identity precedent). Two honest renderings (issue #325):
 *
 * - Healthy (`missingToolNames` empty or omitted — the Cursor harness
 *   always calls it this way: the Cursor SDK connects MCP itself, so
 *   that harness can never observe the live roster):
 *   `<available_datastores>` names the attached datastores, points the
 *   model at describe_datastore first, and carries a standing
 *   failure-disclosure instruction — the only mechanism that covers
 *   tools which connected but fail at call time (the WhatsApp-pilot
 *   outage shape).
 * - Degraded (deep-agent only, from missingRecordTools against the
 *   connected roster): `<unavailable_datastores>` instead — the section
 *   must not promise tools the agent does not have. Names the declared
 *   datastores, states which record tools are missing, and instructs
 *   plain disclosure over improvisation.
 */
export function formatDatastoresSection(
  datastoreUsages: DatastoreUsage[],
  missingToolNames: readonly string[] = [],
): string {
  const entries = datastoreUsages
    .map((u) => u.datastoreRef?.slug)
    .filter((s): s is string => !!s)
    .map((slug) => `- ${slug}`);

  if (missingToolNames.length > 0) {
    return [
      "<unavailable_datastores>",
      "This agent is configured to use the datastores listed below, but the",
      "following record tools failed to connect this turn:",
      missingToolNames.join(", ") + ".",
      "Treat these datastores as unreachable for any operation that needs a",
      "missing tool.",
      "",
      ...entries,
      "",
      "When the user's request depends on one of these datastores, tell them",
      "plainly that the datastore cannot be reached right now. Never answer",
      "from memory, guess, or improvise a substitute for what the datastore",
      "would have returned.",
      "</unavailable_datastores>",
    ].join("\n");
  }

  return [
    "<available_datastores>",
    "You have access to the following datastores through the record tools",
    `(${EXPECTED_RECORD_TOOLS.join(", ")}).`,
    "Before your first operation against a datastore, call describe_datastore to",
    "learn its collections, field encodings, and which operations you are allowed",
    "to perform.",
    "",
    ...entries,
    "",
    "If any record tool is missing from your toolset or a record tool call",
    "fails, the datastore is unreachable: tell the user plainly that you cannot",
    "reach it right now, and do not answer from memory, guess, or improvise a",
    "substitute for what it would have returned.",
    "</available_datastores>",
  ].join("\n");
}
