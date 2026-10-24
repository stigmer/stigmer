/*
 * A file-backed SessionStore standing in for a Stigmer-side one: one
 * JSON-lines file per key under a directory outside every config directory,
 * entries deduplicated by `uuid` (the SDK retries a batch, so an append may
 * repeat), with `load`, `listSubkeys`, `listSessions` and `delete`. Every call
 * is recorded so a probe can show what the SDK asked of it, and in what order.
 *
 * Throwaway, like everything under `__spike__`.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SessionKey, SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

export interface StoreCall {
  op: string;
  key: unknown;
  entries?: number;
  bytes?: number;
  result?: string;
  at: number;
}

const enc = (s: string): string => encodeURIComponent(s);
const subFile = (subpath: string | undefined): string => `${enc(subpath ?? "")}.jsonl`;

export class FileSessionStore implements SessionStore {
  readonly calls: StoreCall[] = [];
  private readonly seen = new Map<string, Set<string>>();

  constructor(
    readonly dir: string,
    private readonly behaviour: { failAppend?: boolean } = {},
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private sessionDir(projectKey: string, sessionId: string): string {
    return join(this.dir, enc(projectKey), enc(sessionId));
  }

  private file(key: SessionKey): string {
    return join(this.sessionDir(key.projectKey, key.sessionId), subFile(key.subpath));
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    const lines = entries.map((e) => JSON.stringify(e));
    const bytes = lines.reduce((n, l) => n + l.length + 1, 0);
    if (this.behaviour.failAppend === true) {
      this.calls.push({ op: "append", key, entries: entries.length, bytes, result: "rejected", at: Date.now() });
      throw new Error("FileSessionStore: append refused (probe)");
    }
    const path = this.file(key);
    mkdirSync(join(path, ".."), { recursive: true });
    const uuids = this.seen.get(path) ?? new Set<string>();
    this.seen.set(path, uuids);
    let written = 0;
    for (const [i, entry] of entries.entries()) {
      if (typeof entry.uuid === "string") {
        if (uuids.has(entry.uuid)) continue;
        uuids.add(entry.uuid);
      }
      appendFileSync(path, `${lines[i]}\n`);
      written += 1;
    }
    this.calls.push({ op: "append", key, entries: entries.length, bytes, result: `wrote ${written}`, at: Date.now() });
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const path = this.file(key);
    if (!existsSync(path)) {
      this.calls.push({ op: "load", key, result: "null", at: Date.now() });
      return null;
    }
    const entries = readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as SessionStoreEntry);
    this.calls.push({ op: "load", key, entries: entries.length, at: Date.now() });
    return entries;
  }

  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    const dir = this.sessionDir(key.projectKey, key.sessionId);
    const subkeys = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".jsonl") && f !== subFile(undefined))
          .map((f) => decodeURIComponent(f.slice(0, -".jsonl".length)))
      : [];
    this.calls.push({ op: "listSubkeys", key, result: JSON.stringify(subkeys), at: Date.now() });
    return subkeys;
  }

  async listSessions(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>> {
    const dir = join(this.dir, enc(projectKey));
    const sessions = existsSync(dir)
      ? readdirSync(dir).map((s) => ({ sessionId: decodeURIComponent(s), mtime: statSync(join(dir, s)).mtimeMs }))
      : [];
    this.calls.push({ op: "listSessions", key: projectKey, result: String(sessions.length), at: Date.now() });
    return sessions;
  }

  async delete(key: SessionKey): Promise<void> {
    this.calls.push({ op: "delete", key, at: Date.now() });
    rmSync(key.subpath === undefined ? this.sessionDir(key.projectKey, key.sessionId) : this.file(key), { recursive: true, force: true });
  }

  /** Every file the store holds, with its size and line count. */
  inventory(): Array<{ file: string; bytes: number; lines: number }> {
    const out: Array<{ file: string; bytes: number; lines: number }> = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else out.push({ file: path.slice(this.dir.length + 1), bytes: statSync(path).size, lines: readFileSync(path, "utf8").split("\n").filter(Boolean).length });
      }
    };
    walk(this.dir);
    return out;
  }
}

/** Every file under a directory with its size: the engine's local copy, for comparison. */
export function filesUnder(root: string): Array<{ file: string; bytes: number }> {
  const out: Array<{ file: string; bytes: number }> = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push({ file: path.slice(root.length + 1), bytes: statSync(path).size });
    }
  };
  walk(root);
  return out;
}
