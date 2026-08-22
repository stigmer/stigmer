// The capture context a remember call attaches to the Memory it creates —
// org addressing plus provenance (agent, session, execution), threaded from
// the runner that synthesized the memory attachment (DD-005 D2; Stage 3
// provenance decision, owner-ratified 2026-08-22).
//
// Resolution mirrors the credential exactly (client.ts resolveToken): the
// per-request HTTP headers when the bridge transport carries them, falling
// back to the STIGMER_MEMORY_* environment captured at stdio startup. Each
// transport uses its natural carrier — headers are per-request on the
// bridge's /memory route, env is per-process on the runner-spawned stdio
// child — and both are written by the SAME author, the runner's
// synthesized attachment (memory-attachment.ts in the runner is the
// cross-repo twin; its test pins these names too).
//
// Trust posture: these values are attribution, never authorization. The
// cloud create handler accepts them only from a session-sandbox credential
// and overrides session/org with the token's own claims; the OSS server
// stores them under the local single-user trust model. A missing field
// degrades to empty — provenance is best-effort, the fact itself is not.

/** Header carrying the execution's org (per-request, bridge route). */
export const MEMORY_ORG_HEADER = "x-stigmer-memory-org";
/** Header carrying the executing agent's id. */
export const MEMORY_AGENT_ID_HEADER = "x-stigmer-memory-agent-id";
/** Header carrying the session id the execution belongs to. */
export const MEMORY_SESSION_ID_HEADER = "x-stigmer-memory-session-id";
/** Header carrying the agent execution id. */
export const MEMORY_EXECUTION_ID_HEADER = "x-stigmer-memory-execution-id";

/** Env var carrying the execution's org (per-process, stdio child). */
export const MEMORY_ORG_ENV = "STIGMER_MEMORY_ORG";
/** Env var carrying the executing agent's id. */
export const MEMORY_AGENT_ID_ENV = "STIGMER_MEMORY_AGENT_ID";
/** Env var carrying the session id the execution belongs to. */
export const MEMORY_SESSION_ID_ENV = "STIGMER_MEMORY_SESSION_ID";
/** Env var carrying the agent execution id. */
export const MEMORY_EXECUTION_ID_ENV = "STIGMER_MEMORY_EXECUTION_ID";

/**
 * Where a proposed memory came from: the org the create is addressed to,
 * plus the provenance triple stamped onto the record. Every field may be
 * empty (best-effort attribution).
 */
export interface CaptureContext {
  readonly org: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly agentExecutionId: string;
}

/** A context with no attribution — the resolve fallback of last resort. */
export const EMPTY_CAPTURE_CONTEXT: CaptureContext = {
  org: "",
  agentId: "",
  sessionId: "",
  agentExecutionId: "",
};

/**
 * The subset of the MCP request `extra` this layer reads to resolve the
 * capture context (the RequestAuth shape in client.ts, for headers).
 * `headers` is the SDK's IsomorphicHeaders: a plain record whose values
 * may be string arrays (Node folds repeated headers that way).
 */
export interface RequestHeaders {
  readonly requestInfo?: {
    readonly headers?: Record<string, string | string[] | undefined>;
  };
}

/**
 * Read the capture context from the process environment — the stdio
 * shape, captured once at server construction exactly like the startup
 * API key. Deliberately NOT part of config.ts: Config mirrors the Go
 * server's operator-facing surface, while these values are
 * runner-injected per execution and owned by this domain.
 */
export function loadCaptureContextFromEnv(env: NodeJS.ProcessEnv = process.env): CaptureContext {
  return {
    org: env[MEMORY_ORG_ENV] ?? "",
    agentId: env[MEMORY_AGENT_ID_ENV] ?? "",
    sessionId: env[MEMORY_SESSION_ID_ENV] ?? "",
    agentExecutionId: env[MEMORY_EXECUTION_ID_ENV] ?? "",
  };
}

/**
 * Resolve the capture context for an inbound remember call: the
 * per-request headers when the transport carries request info (http),
 * otherwise the startup context (stdio). Whole-object, not per-field —
 * the two carriers are set by different processes and never mix.
 */
export function resolveCaptureContext(
  extra: RequestHeaders | undefined,
  startup: CaptureContext,
): CaptureContext {
  const headers = extra?.requestInfo?.headers;
  if (headers === undefined) return startup;
  return {
    org: headerValue(headers, MEMORY_ORG_HEADER),
    agentId: headerValue(headers, MEMORY_AGENT_ID_HEADER),
    sessionId: headerValue(headers, MEMORY_SESSION_ID_HEADER),
    agentExecutionId: headerValue(headers, MEMORY_EXECUTION_ID_HEADER),
  };
}

/**
 * Case-insensitive single-value header lookup. Node lowercases incoming
 * header names but the web-standard transport may not; scanning keeps the
 * lookup honest for both without depending on transport internals.
 */
function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const direct = headers[name];
  if (direct !== undefined) return Array.isArray(direct) ? (direct[0] ?? "") : direct;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && value !== undefined) {
      return Array.isArray(value) ? (value[0] ?? "") : value;
    }
  }
  return "";
}
