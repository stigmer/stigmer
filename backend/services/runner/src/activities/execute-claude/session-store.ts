/**
 * Where a Claude session's conversation lives: the SDK's `SessionStore`,
 * over a backing chosen the way the Stigmer harness's state is placed.
 *
 * The engine writes its transcript to its configuration directory and
 * mirrors every entry to this store as it goes; a turn that resumes loads
 * the whole transcript from the store and nothing else (the configuration
 * directory is the invocation's, removed when it ends, `engine-env.ts`), so
 * the store holds the only durable copy and a session resumes on any
 * runner. Three backings, by `Config.checkpointerType`, the setting that
 * already places the Stigmer harness's conversation (`shared/checkpointer/
 * factory.ts`):
 *
 *  - `sqlite` (the local default): JSON-lines files in the session's
 *    directory (`file-store.ts`), beside the Stigmer harness's checkpoints;
 *  - `http` (cloud mode): the platform, through the runner's local proxy's
 *    engine-sessions lane (`http-store.ts`), as the Stigmer harness's
 *    checkpoints go through its checkpoints lane;
 *  - `memory`: this process, for tests.
 *
 * The store is keyed by the thread and the transcript's subpath alone. The
 * SDK's project key is ignored (the engine's environment fixes it anyway),
 * and a store is built per turn for its own thread: it refuses any session
 * id but the one derived from that thread (`engine-session-id.ts`), so no
 * turn can read or write another's conversation, whatever the engine asks.
 *
 * Every backing deduplicates by an entry's `uuid` (the SDK retries a batch,
 * so an append may repeat), keeps append order, answers `null` for a
 * transcript never written, and lists the sub-agent transcripts a session
 * holds. Pinned once for all three by `__tests__/session-store.test.ts`.
 */

import type { SessionKey, SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

import { engineSessionIdOf } from "./engine-session-id.js";

/** What every backing does, by thread and subpath (`undefined`: the main transcript). */
export interface TranscriptBacking {
  append(threadId: string, subpath: string | undefined, entries: readonly SessionStoreEntry[]): Promise<void>;
  /** The transcript's entries in append order, or `null` when it was never written. */
  load(threadId: string, subpath: string | undefined): Promise<SessionStoreEntry[] | null>;
  /** Every subpath the thread holds a transcript under. */
  listSubkeys(threadId: string): Promise<string[]>;
  /** The transcript at `subpath`, or every transcript of the thread when `subpath` is undefined. */
  delete(threadId: string, subpath: string | undefined): Promise<void>;
}

/** Thrown when the engine names a session that is not this turn's. */
export class ForeignSessionError extends Error {}

/** The SDK's store for one turn's thread, over `backing` (the header). */
/**
 * The calls the store holds: each tool use the engine mirrored, noted once
 * its backing's append resolved, and each one a load read back (a resumed
 * run's calls, mirrored by the run before). The host runs a served call only once the
 * store holds it (`turn.ts`), so a runner lost while the call runs leaves a
 * store that has the call, and the resumed engine reports it interrupted
 * rather than making it again (stigmer#2669).
 */
export class MirroredCalls {
  private readonly held = new Set<string>();
  private readonly waiting = new Map<string, Array<() => void>>();

  /** Record the tool uses in `entries`, waking whoever waits on one. */
  note(entries: readonly SessionStoreEntry[]): void {
    for (const id of toolUseIdsOf(entries)) {
      this.held.add(id);
      for (const wake of this.waiting.get(id) ?? []) wake();
      this.waiting.delete(id);
    }
  }

  /** Whether the store holds the call `id` within `timeoutMs`. */
  whenHeld(id: string, timeoutMs: number): Promise<boolean> {
    if (this.held.has(id)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const rest = (this.waiting.get(id) ?? []).filter((wake) => wake !== onHeld);
        if (rest.length === 0) this.waiting.delete(id);
        else this.waiting.set(id, rest);
        resolve(false);
      }, timeoutMs);
      const onHeld = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      this.waiting.set(id, [...(this.waiting.get(id) ?? []), onHeld]);
    });
  }
}

/** The ids of the tool uses `entries` carry: each assistant message's `tool_use` blocks. */
export function toolUseIdsOf(entries: readonly SessionStoreEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const content = (entry["message"] as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<{ type?: unknown; id?: unknown }>) {
      if (block.type === "tool_use" && typeof block.id === "string") ids.push(block.id);
    }
  }
  return ids;
}

export function sessionStoreFor(threadId: string, backing: TranscriptBacking, mirrored?: MirroredCalls): SessionStore {
  const own = engineSessionIdOf(threadId);
  const check = (sessionId: string): void => {
    if (sessionId !== own) throw new ForeignSessionError(`the session store serves session ${own} alone, not ${sessionId}`);
  };
  return {
    async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
      check(key.sessionId);
      await backing.append(threadId, key.subpath, entries);
      mirrored?.note(entries);
    },
    async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
      check(key.sessionId);
      const entries = await backing.load(threadId, key.subpath);
      if (entries !== null) mirrored?.note(entries);
      return entries;
    },
    async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
      check(key.sessionId);
      return backing.listSubkeys(threadId);
    },
    async delete(key: SessionKey): Promise<void> {
      check(key.sessionId);
      await backing.delete(threadId, key.subpath);
    },
  };
}

/** Entries of `incoming` whose `uuid` is not in `seen`, in order, recording each new one (entries without a `uuid` always pass). */
export function unseenEntries(seen: Set<string>, incoming: readonly SessionStoreEntry[]): SessionStoreEntry[] {
  const out: SessionStoreEntry[] = [];
  for (const entry of incoming) {
    if (typeof entry.uuid === "string") {
      if (seen.has(entry.uuid)) continue;
      seen.add(entry.uuid);
    }
    out.push(entry);
  }
  return out;
}

/** A backing held in this process (tests). */
export class MemoryTranscripts implements TranscriptBacking {
  private readonly transcripts = new Map<string, { entries: SessionStoreEntry[]; seen: Set<string> }>();

  async append(threadId: string, subpath: string | undefined, entries: readonly SessionStoreEntry[]): Promise<void> {
    const key = memoryKey(threadId, subpath);
    const transcript = this.transcripts.get(key) ?? { entries: [], seen: new Set<string>() };
    this.transcripts.set(key, transcript);
    transcript.entries.push(...unseenEntries(transcript.seen, entries).map(copyOf));
  }

  async load(threadId: string, subpath: string | undefined): Promise<SessionStoreEntry[] | null> {
    const transcript = this.transcripts.get(memoryKey(threadId, subpath));
    return transcript === undefined ? null : transcript.entries.map(copyOf);
  }

  async listSubkeys(threadId: string): Promise<string[]> {
    const prefix = `${threadId}\u0000`;
    return [...this.transcripts.keys()].filter((key) => key.startsWith(prefix) && key.length > prefix.length).map((key) => key.slice(prefix.length));
  }

  async delete(threadId: string, subpath: string | undefined): Promise<void> {
    if (subpath !== undefined) {
      this.transcripts.delete(memoryKey(threadId, subpath));
      return;
    }
    for (const key of [...this.transcripts.keys()]) if (key.startsWith(`${threadId}\u0000`)) this.transcripts.delete(key);
  }
}

function memoryKey(threadId: string, subpath: string | undefined): string {
  return `${threadId}\u0000${subpath ?? ""}`;
}

/** A deep copy, so a caller holding an entry never edits the store's. */
function copyOf(entry: SessionStoreEntry): SessionStoreEntry {
  return JSON.parse(JSON.stringify(entry)) as SessionStoreEntry;
}
