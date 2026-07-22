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
 * pinnedToolApprovals mean mergeApprovalPolicies emits no entries for
 * this server — zero classifier involvement. `discoveredCapabilitiesEmpty`
 * is false and the attachment has no McpServerUsage, so the connect
 * backfill (whose destructiveHint tightener would force-gate
 * delete_record — silently skipped on channels under UNATTENDED mode)
 * is structurally unable to touch it. Callers must still inject AFTER
 * resolve + backfill; both harness call sites do.
 */

import type { DatastoreUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { ResolvedMcpServer } from "./mcp-resolver.js";

/**
 * The synthesized attachment's slug. Reserved: a user McpServer with
 * this slug is shadowed by the synthesized attachment (the record tools
 * must exist whenever `datastore_usages` says so), with a warning.
 */
export const DATASTORE_ATTACHMENT_SLUG = "stigmer-records";

/** The bridge route serving the records-only roster (mcp-server T05 R1). */
export const RECORDS_ROUTE = "/records";

export interface DatastoreAttachmentOptions {
  /**
   * The bridge's HTTP endpoint (STIGMER_MCP_BRIDGE_ENDPOINT, e.g.
   * https://mcp.stigmer.ai). Null selects the OSS stdio shape.
   */
  bridgeEndpoint: string | null;
  /**
   * The execution's session-scoped credential (the sandbox token a
   * cloud runner holds, or the desktop runner's exchanged scoped
   * token). Null attaches no Authorization header (OSS/local).
   */
  credential: string | null;
  /**
   * The stigmer backend endpoint the stdio child dials
   * (config.stigmerBackendEndpoint). Only used for the OSS shape.
   */
  backendEndpoint: string;
}

/**
 * Synthesize the records attachment for an agent's datastore usages.
 * Returns undefined when the agent uses no datastores — the attachment
 * exists exactly when the usage edge does.
 */
export function synthesizeDatastoreAttachment(
  datastoreUsages: DatastoreUsage[],
  options: DatastoreAttachmentOptions,
): ResolvedMcpServer | undefined {
  if (datastoreUsages.length === 0) {
    return undefined;
  }

  // Approval-free by construction + backfill-proof: see file header.
  const base = {
    slug: DATASTORE_ATTACHMENT_SLUG,
    toolApprovals: [],
    pinnedToolApprovals: [],
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
 * Inject the synthesized attachment into a resolved server list —
 * AFTER resolve + backfill (see file header). A user server shadowing
 * the reserved slug is replaced, loudly.
 */
export function injectDatastoreAttachment(
  resolvedServers: ResolvedMcpServer[],
  attachment: ResolvedMcpServer,
): ResolvedMcpServer[] {
  const shadowed = resolvedServers.some((s) => s.slug === attachment.slug);
  if (shadowed) {
    console.warn(
      `MCP server slug "${attachment.slug}" is reserved for the datastore ` +
      "records attachment; the user-defined server is replaced.",
    );
  }
  return [
    ...resolvedServers.filter((s) => s.slug !== attachment.slug),
    attachment,
  ];
}

/**
 * The `<available_datastores>` prompt section (DD-005 SD-5, the
 * skills-section precedent): names the attached datastores and points
 * the model at describe_datastore first. Shared by both harnesses so
 * the section text cannot drift (the sender-identity precedent).
 */
export function formatDatastoresSection(datastoreUsages: DatastoreUsage[]): string {
  const slugs = datastoreUsages
    .map((u) => u.datastoreRef?.slug)
    .filter((s): s is string => !!s);
  const entries = slugs.map((slug) => `- ${slug}`);
  return [
    "<available_datastores>",
    "You have access to the following datastores through the record tools",
    "(describe_datastore, find_records, insert_record, update_record, delete_record).",
    "Before your first operation against a datastore, call describe_datastore to",
    "learn its collections, field encodings, and which operations you are allowed",
    "to perform.",
    "",
    ...entries,
    "</available_datastores>",
  ].join("\n");
}

/**
 * The gRPC dial target (host:port) for a backend endpoint URL — the
 * shape STIGMER_SERVER_ADDRESS wants (the bridge warns on schemes).
 */
function grpcTarget(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
