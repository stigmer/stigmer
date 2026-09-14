/**
 * Session-keyed Cursor SDK store — the on-disk SQLite store a session's
 * agent records, runs and checkpoints live in, opened once per session and
 * handed to every `Agent.create` / `Agent.resume` of that session
 * (stigmer/stigmer#1053).
 *
 * Why this exists: `@cursor/sdk` 1.0.31 removed the `platform` option the
 * runner used to key the SDK's store (`platform.workspaceRef` /
 * `platform.stateRoot`) and replaced it with a caller-owned
 * `local.store: LocalAgentStore`. The SDK's own instruction is "open once per
 * workspace / state root and reuse across `Agent.create` / `resume`". So the
 * store has a lifetime the runner owns, and this module is where it lives.
 *
 * Where the store lives on disk is unchanged from the `platform` era:
 * `{workspaceRootDir}/.stigmer/cursor-sdk-state/{sessionId}` — the durable
 * workspace volume rather than `$HOME`, so native `Agent.resume()` survives
 * pod restart, reschedule and snapshot restore; keyed by sessionId so sessions
 * sharing one volume (a workflow sandbox's child agent executions) never
 * collide. The `workspaceRef` is the same synthetic `stigmer-session:<id>`,
 * deliberately not a filesystem path, so lookups are stable regardless of
 * `process.cwd()` (in a cloud sandbox that is the runner's app directory, not
 * the workspace).
 *
 * Lifetime — the session's, on the two hooks the adapter already has:
 * - `sessionStore()` opens on first use and memoizes the OPEN PROMISE per
 *   session, so two activities racing on one session (the agent cache's
 *   documented race: the loser resolves its own agent) await the same open
 *   instead of racing two opens on one file. A failed open is not memoized;
 *   the next call retries.
 * - `releaseSessionStore(sessionId)` is called from the adapter's
 *   `releaseSession` — the runtime saying the session is done on this host.
 * - `releaseAllSessionStores()` is called from the adapter's `shutdown`.
 * - A re-acquire under a DIFFERENT state root (the session moved volumes)
 *   releases the store it held and opens the new one — the same rule the agent
 *   cache applies to a fingerprint mismatch: a handle for the old binding can
 *   never serve the new one, and holding it would only pin a file.
 * Nothing else disposes a store. In particular the store does NOT ride the
 * agent handle's `close()` — the handle has five close sites and a second
 * resource on each would be a parallel lifecycle — and it does not enter the
 * agent cache, whose exclusive-checkout model is about one handle per turn.
 *
 * At 1.0.13 the SDK memoized its platform (with open SQLite handles) for the
 * whole process; a per-session store released when the session is released is
 * a tighter lifetime, not a looser one.
 *
 * `SessionStores` is the mechanism with the opener injected, so its rules are
 * unit-tested without a SQLite file; the module-level instance binds the SDK's
 * `SqliteLocalAgentStore.open` (`@cursor/sdk/sqlite`, the subpath entry that
 * keeps the sqlite driver off the main package's import path). In a hermetic
 * run that subpath is doubled beside `@cursor/sdk` itself (`scripted-sdk.ts`).
 *
 * THIS MODULE'S STATIC GRAPH IS SDK-FREE, like `agent-session-cache.ts`: the
 * adapter imports both statically, and the adapter's own static graph must
 * stay SDK-free so the composition roots can import it before `boot` installs
 * the interceptors (`adapter.ts` header). The SDK's sqlite entry is loaded
 * with a dynamic import at the first open — the runner's
 * dynamic-import-for-order convention — and only its TYPE is imported here.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SqliteLocalAgentStore } from "@cursor/sdk/sqlite";

const CURSOR_SDK_STATE_DIR = ".stigmer/cursor-sdk-state";

/** Where a session's store lives and the ref the SDK scopes it under. */
export interface SessionStoreLocation {
  /** Synthetic, stable across activity invocations: `stigmer-session:<sessionId>`. */
  readonly workspaceRef: string;
  /** `{workspaceRootDir}/.stigmer/cursor-sdk-state/{sessionId}`, created eagerly. */
  readonly stateRoot: string;
}

/** The slice of the SDK store whose lifetime this module owns. */
export interface ReleasableStore {
  readonly stateRoot: string;
  dispose(): Promise<void>;
}

/**
 * Compute a session's store location. Both inputs are required and must be
 * non-empty: the state root is keyed by sessionId, so an empty sessionId would
 * collapse every session sharing the volume onto one store and corrupt their
 * conversation state; an empty root would put the store somewhere that does
 * not survive a restart. The directory is created eagerly to prevent ENOENT on
 * the SDK's first write.
 */
export function resolveSessionStoreLocation(sessionId: string, workspaceRootDir: string): SessionStoreLocation {
  if (!sessionId) {
    throw new Error(
      "resolveSessionStoreLocation: sessionId is required but was empty. The Cursor SDK " +
        "state store is keyed by sessionId; an empty value would collide across sessions " +
        "sharing a workspace volume (e.g. a workflow sandbox's child agent executions).",
    );
  }
  if (!workspaceRootDir) {
    throw new Error(
      "resolveSessionStoreLocation: workspaceRootDir is required but was empty. The Cursor " +
        "SDK state store must live on the durable workspace volume to survive restarts.",
    );
  }
  const stateRoot = join(workspaceRootDir, CURSOR_SDK_STATE_DIR, sessionId);
  mkdirSync(stateRoot, { recursive: true });
  return { workspaceRef: `stigmer-session:${sessionId}`, stateRoot };
}

/** One store per session, opened through `open`, held until released. */
export class SessionStores<S extends ReleasableStore> {
  private readonly held = new Map<string, { readonly stateRoot: string; readonly store: Promise<S> }>();

  constructor(private readonly open: (location: SessionStoreLocation) => Promise<S>) {}

  /** The session's store, opened on first use; the same instance on every later call. */
  acquire(sessionId: string, workspaceRootDir: string): Promise<S> {
    const location = resolveSessionStoreLocation(sessionId, workspaceRootDir);
    const existing = this.held.get(sessionId);
    if (existing && existing.stateRoot === location.stateRoot) return existing.store;
    if (existing) {
      console.log(
        `session-store: session=${sessionId} re-acquired under a different state root ` +
          `(held=${existing.stateRoot}, requested=${location.stateRoot}) — releasing the held store`,
      );
      void this.release(sessionId);
    }
    const store = this.open(location);
    this.held.set(sessionId, { stateRoot: location.stateRoot, store });
    // A failed open must not be memoized: the next acquire retries. Only the
    // entry THIS open created is removed (a later re-acquire may have replaced it).
    store.catch(() => {
      if (this.held.get(sessionId)?.store === store) this.held.delete(sessionId);
    });
    return store;
  }

  /** Disposes and forgets the session's store, if any. A later acquire reopens. */
  async release(sessionId: string): Promise<void> {
    const entry = this.held.get(sessionId);
    if (!entry) return;
    this.held.delete(sessionId);
    await disposeQuietly(sessionId, entry.store);
  }

  /** Worker shutdown: dispose every held store. */
  async releaseAll(): Promise<void> {
    const entries = [...this.held.entries()];
    this.held.clear();
    await Promise.all(entries.map(([sessionId, entry]) => disposeQuietly(sessionId, entry.store)));
  }

  /** How many stores are held — for assertions. */
  get size(): number {
    return this.held.size;
  }
}

async function disposeQuietly<S extends ReleasableStore>(sessionId: string, store: Promise<S>): Promise<void> {
  try {
    await (await store).dispose();
  } catch (err) {
    // Best effort: a store whose open failed has nothing to dispose, and a
    // dispose that fails on a dead handle changes nothing the session needs.
    console.warn(
      `session-store: dispose failed for session=${sessionId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

const sessionStores = new SessionStores<SqliteLocalAgentStore>(async (location) => {
  const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");
  return SqliteLocalAgentStore.open(location);
});

/** The session's SDK store, opened on first use — pass as `local.store` on create AND resume. */
export function sessionStore(sessionId: string, workspaceRootDir: string): Promise<SqliteLocalAgentStore> {
  return sessionStores.acquire(sessionId, workspaceRootDir);
}

/** The session is done on this host (the adapter's `releaseSession`). */
export function releaseSessionStore(sessionId: string): Promise<void> {
  return sessionStores.release(sessionId);
}

/** Worker shutdown (the adapter's `shutdown`). */
export function releaseAllSessionStores(): Promise<void> {
  return sessionStores.releaseAll();
}
