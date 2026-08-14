import { Code, ConnectError } from "@connectrpc/connect";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { ConnectInput } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ConnectPhase } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { isUnimplemented, wrapError } from "./gen/errors.js";

/**
 * The slice of {@link McpServerClient} the connect protocol needs — the
 * async-lane pair plus the blocking fallback. Structural on purpose: the
 * full client satisfies it, and tests can hand in three functions.
 */
export interface McpServerConnectLane {
  startConnect(input: ConnectInput): Promise<McpServer>;
  connect(input: ConnectInput): Promise<McpServer>;
  get(id: string): Promise<McpServer>;
}

/**
 * How often {@link connectAndWait} re-reads the resource while a connect
 * operation runs. Discovery legitimately takes tens of seconds to minutes;
 * a few seconds of staleness is invisible next to that, and each poll is
 * one cheap get.
 */
export const CONNECT_POLL_INTERVAL_MS = 2_500;

/**
 * Absolute bound on waiting for a connect to settle: the backend's async
 * connect ceiling (its asyncConnectTimeout, 60 min) plus margin. Every
 * operation settles within the ceiling by construction; only a
 * connect_status orphaned by a backend restart can still read CONNECTING
 * past it, and this bound turns that into a typed error instead of an
 * infinite wait.
 */
export const CONNECT_SETTLE_BOUND_MS = 65 * 60_000;

/**
 * Thrown by {@link connectAndWait} when it stopped waiting while the
 * server-side operation was still running. NOT a failure: the backend
 * finishes the connect on its own and persists the result — re-read the
 * resource (or re-run the connect) to observe the outcome.
 */
export class ConnectStillRunningError extends Error {
  readonly mcpServerId: string;

  constructor(mcpServerId: string, waitedMs: number) {
    super(
      `the connect of MCP server '${mcpServerId}' is still running server-side after ${Math.round(waitedMs / 1000)}s — ` +
        "it will persist its result on its own; re-read the server to observe the outcome",
    );
    this.name = "ConnectStillRunningError";
    this.mcpServerId = mcpServerId;
  }
}

/** Options for {@link connectAndWait}. */
export interface ConnectAndWaitOptions {
  /** Poll cadence. Defaults to {@link CONNECT_POLL_INTERVAL_MS}. */
  readonly pollIntervalMs?: number;
  /**
   * Stop waiting after this long (soft bound — the server-side operation
   * keeps running). Defaults to {@link CONNECT_SETTLE_BOUND_MS}, and is
   * capped by it: waiting longer than the backend's own ceiling can only
   * ever observe an orphaned record.
   */
  readonly deadlineMs?: number;
  /**
   * Observe the CONNECTING snapshot the moment the operation is accepted —
   * the place to read `status.connect_status.warning` (the dead-runner
   * advisory) before the wait begins. Not called on the blocking fallback,
   * which has no start-time snapshot.
   */
  readonly onStarted?: (started: McpServer) => void;
}

/**
 * Connect an MCP server and wait for the operation to settle, without any
 * long-lived RPC (stigmer/stigmer#425).
 *
 * Uses the async lane — `startConnect` returns immediately with
 * `status.connect_status = CONNECTING`, then the resource is polled until
 * the operation settles — so the wait survives transport limits that kill
 * a long-blocking unary call (browsers drop no-bytes responses around
 * ~300s, below the server's discovery ceiling). Callers never see the
 * mechanics: the promise resolves with the updated server exactly as the
 * blocking `connect` RPC resolved, and a failed operation rejects with the
 * same {@link StigmerError} classification the blocking RPC would have
 * thrown (`connect_status.failure_code` is the Go gRPC code name, which
 * matches connect-es `Code` member names — rehydration is lossless).
 *
 * Backends that predate the async lane answer UNIMPLEMENTED for
 * `startConnect`; this falls back to the blocking `connect` RPC — the same
 * edition capability-probe idiom as the skill artifact-transfer lane
 * (skill.ts) and the org-OAuth-app surface.
 */
export async function connectAndWait(
  client: McpServerConnectLane,
  input: ConnectInput,
  options?: ConnectAndWaitOptions,
): Promise<McpServer> {
  const pollIntervalMs = options?.pollIntervalMs ?? CONNECT_POLL_INTERVAL_MS;
  const waitMs = Math.min(options?.deadlineMs ?? CONNECT_SETTLE_BOUND_MS, CONNECT_SETTLE_BOUND_MS);

  let started: McpServer;
  try {
    started = await client.startConnect(input);
  } catch (err) {
    if (!isUnimplemented(err)) throw err;
    return blockingConnect(client, input, waitMs);
  }
  options?.onStarted?.(started);

  const deadline = Date.now() + waitMs;
  for (;;) {
    if (Date.now() >= deadline) {
      throw new ConnectStillRunningError(input.mcpServerId, waitMs);
    }
    await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));

    const current = await client.get(input.mcpServerId);
    const cs = current.status?.connectStatus;
    if (cs?.phase === ConnectPhase.succeeded) return current;
    if (cs?.phase === ConnectPhase.failed) {
      throw rehydrateConnectFailure(cs.failureCode, cs.failureMessage);
    }
  }
}

// The pre-async-lane path, kept behaviorally identical for old backends: one
// blocking RPC, raced (not cancelled — the server finishes and persists on
// its own) against the caller's soft bound.
async function blockingConnect(client: McpServerConnectLane, input: ConnectInput, waitMs: number): Promise<McpServer> {
  const push = client.connect(input);
  // The losing push may settle after the caller has moved on; swallow its
  // late rejection so it cannot surface as an unhandled-rejection crash.
  void push.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ConnectStillRunningError(input.mcpServerId, waitMs)), waitMs);
  });
  try {
    return await Promise.race([push, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Rebuild the failure the blocking connect RPC would have thrown, from the
// classification the backend persisted on connect_status. Routing the
// rehydrated ConnectError through wrapError makes the result byte-identical
// to a live RPC failure (same StigmerError code mapping, same raw message).
function rehydrateConnectFailure(failureCode: string, failureMessage: string) {
  const code = (Code as Record<string, unknown>)[failureCode];
  return wrapError(new ConnectError(failureMessage, typeof code === "number" ? (code as Code) : Code.Unknown));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
