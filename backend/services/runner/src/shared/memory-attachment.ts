/**
 * The runner-synthesized memory capture attachment (DD-005 D1).
 *
 * When the execution's recall snapshot says memory is on
 * (`spec.recalled_memories.enabled` — the ONE server-owned field that
 * serves both the recall and capture sides, stamped by the create
 * pipeline's compose step), the runner synthesizes ONE MCP attachment
 * serving the `remember` tool. No discovery RPC exists on this path:
 * unlike the channel attachment's registry read, the enablement answer
 * is already on the spec — a free, synchronous read (the
 * conversation-attachment session-label precedent). The enabled bit with
 * ZERO facts is a meaningful state: memory is on, nothing stored yet —
 * the tool is offered so the first fact can be proposed.
 *
 * Two connection shapes, one roster (the channels pattern):
 *   - Bridge endpoint configured (cloud): Streamable HTTP against the
 *     bridge's /memory route with the execution's own session-scoped
 *     credential as the Bearer token, plus the capture context as
 *     per-request headers.
 *   - No bridge endpoint (OSS/local): a spawned `stigmer mcp-server`
 *     stdio child with STIGMER_MCP_ROSTER=memory, plus the capture
 *     context as STIGMER_MEMORY_* env.
 *
 * The capture context (org + agent/session/execution ids) is
 * attribution, never authorization (the Stage 3 provenance decision,
 * owner-ratified 2026-08-22): the cloud create handler accepts it only
 * from a session-sandbox credential and overrides session/org with the
 * token's own claims; the OSS server stores it under the local
 * single-user trust model. The subject is never threaded — the server
 * derives it from the credential (DD-005 D2).
 *
 * Approval-free by construction (the synthesized-attachment contract):
 * the tool only ever creates a PROPOSAL the user must confirm through
 * the control plane, so gating the propose call would stack a second
 * consent gate in front of the real one (DD-005 D3: consent is the
 * confirm RPC, not tool approval). Callers inject AFTER resolve +
 * backfill.
 *
 * Failure posture: the attachment is synthesized from values already in
 * hand, so the only failure mode is the create RPC refusing at call
 * time — which the mcp-server's memory error mapper relays honestly.
 * When the snapshot is absent or disabled: no tool, honest absence.
 */

import type { RecalledMemories } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { ResolvedMcpServer } from "./mcp-resolver.js";
import { grpcTarget, type SynthesizedAttachmentOptions } from "./synthesized-attachment.js";

/**
 * The synthesized attachment's slug. Reserved: a user McpServer with
 * this slug is shadowed by the synthesized attachment, with a warning.
 * Runner-internal (the resolved-server name and shadow key — the
 * mcp-server never sees it); pinned by this module's test. The ROUTE
 * and the context keys below are cross-repo strings, pinned on both
 * sides (the TOOL_CALL_LIMIT precedent).
 */
export const MEMORY_ATTACHMENT_SLUG = "stigmer-memory";

/** The bridge route serving the memory-only roster (mcp-server twin: MEMORY_ROUTE). */
export const MEMORY_ROUTE = "/memory";

/**
 * The capture-context carriers, mirrored byte-for-byte by the
 * mcp-server's memory domain (domains/memory/context.ts): headers on
 * the bridge's per-request path, env on the stdio child — the same
 * per-request-then-startup split the credential itself uses.
 */
export const MEMORY_ORG_HEADER = "x-stigmer-memory-org";
export const MEMORY_AGENT_ID_HEADER = "x-stigmer-memory-agent-id";
export const MEMORY_SESSION_ID_HEADER = "x-stigmer-memory-session-id";
export const MEMORY_EXECUTION_ID_HEADER = "x-stigmer-memory-execution-id";

export const MEMORY_ORG_ENV = "STIGMER_MEMORY_ORG";
export const MEMORY_AGENT_ID_ENV = "STIGMER_MEMORY_AGENT_ID";
export const MEMORY_SESSION_ID_ENV = "STIGMER_MEMORY_SESSION_ID";
export const MEMORY_EXECUTION_ID_ENV = "STIGMER_MEMORY_EXECUTION_ID";

/**
 * Where a proposed memory comes from — threaded to the mcp-server so
 * the create request carries org addressing and provenance. Empty
 * fields are omitted from the carrier (best-effort attribution; the
 * server treats absent as empty).
 */
export interface MemoryCaptureContext {
  readonly org: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly agentExecutionId: string;
}

/**
 * Reports whether the execution's recall snapshot offers the remember
 * tool (DD-005 D1: the snapshot's enabled bit IS the runner's injection
 * signal — one server-owned field, no parallel flag, no discovery
 * round-trip). Exposed for the harnesses' MCP gates, which must open
 * MCP resolution for a memory-only agent.
 */
export function memoryCaptureEnabled(recalled: RecalledMemories | undefined): boolean {
  return recalled?.enabled === true;
}

/**
 * Synthesize the memory capture attachment. Returns undefined when the
 * recall snapshot is absent or disabled — the attachment exists exactly
 * when the server-composed snapshot says memory is on.
 */
export function synthesizeMemoryAttachment(
  recalled: RecalledMemories | undefined,
  context: MemoryCaptureContext,
  options: SynthesizedAttachmentOptions,
): ResolvedMcpServer | undefined {
  if (!memoryCaptureEnabled(recalled)) {
    return undefined;
  }

  // Approval-free by construction + backfill-proof: see file header.
  const base = {
    slug: MEMORY_ATTACHMENT_SLUG,
    toolApprovals: [],
    pinnedToolApprovals: [],
    toolApprovalOverrides: [],
    discoveredCapabilitiesEmpty: false,
  };

  if (options.bridgeEndpoint !== null && options.bridgeEndpoint !== "") {
    return {
      ...base,
      connectionType: "http",
      url: options.bridgeEndpoint.replace(/\/+$/, "") + MEMORY_ROUTE,
      headers: {
        ...(options.credential !== null && options.credential !== ""
          ? { Authorization: `Bearer ${options.credential}` }
          : undefined),
        ...nonEmptyEntries([
          [MEMORY_ORG_HEADER, context.org],
          [MEMORY_AGENT_ID_HEADER, context.agentId],
          [MEMORY_SESSION_ID_HEADER, context.sessionId],
          [MEMORY_EXECUTION_ID_HEADER, context.agentExecutionId],
        ]),
      },
    };
  }

  return {
    ...base,
    connectionType: "stdio",
    command: "stigmer",
    args: ["mcp-server"],
    env: {
      STIGMER_MCP_ROSTER: "memory",
      STIGMER_SERVER_ADDRESS: grpcTarget(options.backendEndpoint),
      ...nonEmptyEntries([
        [MEMORY_ORG_ENV, context.org],
        [MEMORY_AGENT_ID_ENV, context.agentId],
        [MEMORY_SESSION_ID_ENV, context.sessionId],
        [MEMORY_EXECUTION_ID_ENV, context.agentExecutionId],
      ]),
    },
  };
}

/** The non-empty context fields as carrier entries (absent means empty). */
function nonEmptyEntries(
  pairs: ReadonlyArray<readonly [string, string]>,
): Record<string, string> {
  return Object.fromEntries(pairs.filter(([, value]) => value !== ""));
}
