/**
 * Session-keyed Cursor agent cache — keeps the SDK executor (and its stdio
 * MCP server processes) alive across turns of the SAME session (#215).
 *
 * Why this exists: the SDK's local executor cache is refcounted and keyed
 * by the full acquisition config (workingDirectory, hashed apiKey,
 * settingSources, mcpServers, customSubagents). `agent.close()` releases
 * the agent's lease; at refcount zero the executor is DISPOSED and every
 * stdio MCP server is killed. The activity used to close on every terminal
 * path, so each turn re-acquired the executor and re-spawned every MCP
 * server inside `agent.send()` — a measured 2.2–3.2s per-turn tax
 * (`turn_first_event`'s `send_returned` segment).
 *
 * Ownership model — exclusive checkout, explicit lifetime:
 * - A finishing turn PARKS its healthy agent here (`cacheSessionAgent`);
 *   the next activity for the session CHECKS IT OUT (`takeCachedAgent`),
 *   removing it from the cache, so two concurrent activities can never
 *   share one Agent handle — the loser of the race resolves its own.
 * - The cached agent is reused only when the acquisition FINGERPRINT
 *   matches. Any config drift (rotated credential, edited MCP servers,
 *   model change, different workspace) closes the parked agent and forces
 *   a fresh resolve — correctness by construction: a reused executor would
 *   otherwise keep serving the OLD config.
 * - Failure paths never park: a suspect agent is closed where it failed
 *   (the pre-existing close sites), and `evictSessionAgent` clears any
 *   parked entry when a session's state is replaced out from under it.
 * - Idle TTL + LRU cap bound memory on multi-session hosts (the desktop
 *   runner-manager hosts many sessions per process; a cloud sandbox is
 *   session-pinned and holds at most one entry). Worker shutdown closes
 *   everything (`closeAllCachedAgents`).
 */

import { createHash } from "node:crypto";

/** The slice of SDKAgent this cache needs — close() releases the executor lease. */
export interface CacheableAgent {
  readonly agentId: string;
  close(): void;
}

interface CachedSessionAgent {
  readonly agent: CacheableAgent;
  readonly fingerprint: string;
  readonly evictTimer: NodeJS.Timeout;
  /** Insertion-order tiebreaker for the LRU cap. */
  readonly parkedAt: number;
}

/**
 * Default idle lifetime for a parked agent. Long enough to cover human
 * think-time between turns and approval round-trips; short enough that an
 * abandoned session does not pin MCP subprocesses for hours.
 */
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;

/**
 * Ceiling on concurrently parked agents (each holds an executor + its MCP
 * subprocesses). Cloud sandboxes never approach it (one session per pod);
 * it protects long-lived desktop runner-managers.
 */
const MAX_PARKED_AGENTS = 32;

function resolveIdleTtlMs(): number {
  const parsed = Number.parseInt(process.env.STIGMER_CURSOR_AGENT_CACHE_TTL_MS ?? "", 10);
  return parsed > 0 ? parsed : DEFAULT_IDLE_TTL_MS;
}

const parkedAgents = new Map<string, CachedSessionAgent>();

function closeQuietly(agent: CacheableAgent): void {
  try {
    agent.close();
  } catch {
    /* best effort — the lease release is advisory on an already-dead agent */
  }
}

/**
 * Fingerprint of everything that determines whether a parked agent can
 * serve the next turn as-is: the SDK executor cache key inputs PLUS the
 * per-agent options resume() re-supplies (model selection, sub-agents).
 * The API key contributes only as a hash — the fingerprint must never be
 * a secret-bearing value (it appears in no logs, but defense in depth).
 */
export function computeAgentFingerprint(createOptions: Record<string, unknown>): string {
  const { apiKey, ...rest } = createOptions;
  const material = {
    ...rest,
    apiKeyHash:
      typeof apiKey === "string" && apiKey.length > 0
        ? createHash("sha256").update(apiKey).digest("hex")
        : undefined,
  };
  return createHash("sha256").update(stableStringify(material)).digest("hex");
}

/** Deterministic JSON: object keys sorted recursively (the SDK's own idiom). */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Exclusive checkout: returns the parked agent for the session and removes
 * it from the cache, or undefined when there is nothing reusable.
 *
 * A parked agent is reusable only when BOTH hold:
 * - `fingerprint` matches (config identical to what the agent was built with);
 * - `expectedAgentId`, when non-empty, matches the parked agent (the
 *   session's harnessStateId is the source of truth — a recovery in another
 *   activity may have replaced the agent since this one was parked).
 *
 * A mismatch on either closes the parked agent: it can never serve this
 * session again, and holding it would only pin dead MCP processes.
 */
export function takeCachedAgent(
  sessionId: string,
  fingerprint: string,
  expectedAgentId: string,
): CacheableAgent | undefined {
  const entry = parkedAgents.get(sessionId);
  if (!entry) return undefined;

  parkedAgents.delete(sessionId);
  clearTimeout(entry.evictTimer);

  const agentMatches = expectedAgentId === "" || entry.agent.agentId === expectedAgentId;
  if (entry.fingerprint !== fingerprint || !agentMatches) {
    console.log(
      `agent-session-cache: parked agent for session=${sessionId} not reusable ` +
      `(fingerprintMatch=${entry.fingerprint === fingerprint}, agentIdMatch=${agentMatches}) — closing`,
    );
    closeQuietly(entry.agent);
    return undefined;
  }

  return entry.agent;
}

/**
 * Parks a healthy agent for the session's next turn. Replaces (and closes)
 * any agent already parked for the session; evicts the oldest entry when
 * the cap is reached.
 */
export function cacheSessionAgent(
  sessionId: string,
  agent: CacheableAgent,
  fingerprint: string,
): void {
  if (!sessionId) {
    // No stable key to reuse by — release the lease as before the cache.
    closeQuietly(agent);
    return;
  }

  const displaced = parkedAgents.get(sessionId);
  if (displaced) {
    clearTimeout(displaced.evictTimer);
    closeQuietly(displaced.agent);
  }

  if (parkedAgents.size >= MAX_PARKED_AGENTS) {
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [key, entry] of parkedAgents) {
      if (entry.parkedAt < oldestAt) {
        oldestAt = entry.parkedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) evictSessionAgent(oldestKey);
  }

  const ttlMs = resolveIdleTtlMs();
  const evictTimer = setTimeout(() => evictSessionAgent(sessionId), ttlMs);
  // Never keep the process alive just to evict an idle agent.
  evictTimer.unref?.();

  parkedAgents.set(sessionId, {
    agent,
    fingerprint,
    evictTimer,
    parkedAt: Date.now(),
  });
}

/** Closes and forgets the parked agent for a session, if any. */
export function evictSessionAgent(sessionId: string): void {
  const entry = parkedAgents.get(sessionId);
  if (!entry) return;
  parkedAgents.delete(sessionId);
  clearTimeout(entry.evictTimer);
  closeQuietly(entry.agent);
  console.log(`agent-session-cache: evicted parked agent for session=${sessionId}`);
}

/** Worker shutdown: release every parked lease so executors dispose cleanly. */
export function closeAllCachedAgents(): void {
  for (const [sessionId, entry] of parkedAgents) {
    clearTimeout(entry.evictTimer);
    closeQuietly(entry.agent);
    console.log(`agent-session-cache: closed parked agent for session=${sessionId} (shutdown)`);
  }
  parkedAgents.clear();
}

/** Test seam. */
export function _resetAgentSessionCacheForTests(): void {
  for (const entry of parkedAgents.values()) {
    clearTimeout(entry.evictTimer);
  }
  parkedAgents.clear();
}

/** Test seam. */
export function _parkedAgentCountForTests(): number {
  return parkedAgents.size;
}
