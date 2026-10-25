/**
 * A Claude session's conversation on this machine's disk: the session
 * store's backing on a runner that keeps the native engine's conversation
 * locally too (`session-store.ts`).
 *
 * One directory per thread under the session's Claude directory
 * (`shared/workspace/platform-dir.ts` `getClaudeTranscriptDir`): the main
 * transcript in `transcript.jsonl` and each sub-agent's under `subpaths/`,
 * one JSON entry per line, appended in order. Outside the workspace and
 * outside what the agent's `.stigmer` link shows, like every tree of the
 * session's.
 *
 * An entry whose `uuid` the file already holds is not written again (the
 * SDK retries a batch); the uuids a file holds are read from it once per
 * turn, on its first append. A turn runs alone on its session (the
 * workspace lock), so nothing else writes these files while it does.
 *
 * Every write ends its last entry with a newline, so text after a file's
 * last newline is a write a crash cut short: no append that wrote it ever
 * returned. It is not an entry: a read leaves it out, and the first append
 * after it cuts it off before writing, so the next entry starts on a line
 * of its own. A complete line that does not parse is damage no crash
 * explains, and a read of it throws: resuming over it would hand the engine
 * a conversation with a hole.
 */

import { appendFile, mkdir, readdir, readFile, rm, truncate } from "node:fs/promises";
import { join } from "node:path";
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

import { unseenEntries, type TranscriptBacking } from "./session-store.js";

const MAIN_FILE = "transcript.jsonl";
const SUBPATH_DIR = "subpaths";
const SUFFIX = ".jsonl";

/** The file backing over one session's transcript directory (the header). */
export class FileTranscripts implements TranscriptBacking {
  private readonly seen = new Map<string, Set<string>>();

  constructor(private readonly root: string) {}

  async append(threadId: string, subpath: string | undefined, entries: readonly SessionStoreEntry[]): Promise<void> {
    const file = this.fileOf(threadId, subpath);
    let seen = this.seen.get(file);
    if (seen === undefined) {
      const read = await readTranscript(file);
      if (read !== null && read.torn) await truncate(file, read.completeBytes);
      seen = new Set((read?.entries ?? []).flatMap((entry) => (typeof entry.uuid === "string" ? [entry.uuid] : [])));
      this.seen.set(file, seen);
    }
    const fresh = unseenEntries(seen, entries);
    if (fresh.length === 0) return;
    await mkdir(join(file, ".."), { recursive: true });
    await appendFile(file, fresh.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  }

  /** The file's complete entries; `null` when it holds none, as a first write a crash cut short leaves it: no conversation to resume. */
  async load(threadId: string, subpath: string | undefined): Promise<SessionStoreEntry[] | null> {
    const read = await readTranscript(this.fileOf(threadId, subpath));
    return read === null || read.entries.length === 0 ? null : read.entries;
  }

  async listSubkeys(threadId: string): Promise<string[]> {
    try {
      const names = await readdir(join(this.threadDir(threadId), SUBPATH_DIR));
      return names.filter((name) => name.endsWith(SUFFIX)).map((name) => decodeURIComponent(name.slice(0, -SUFFIX.length)));
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }

  async delete(threadId: string, subpath: string | undefined): Promise<void> {
    const target = subpath === undefined ? this.threadDir(threadId) : this.fileOf(threadId, subpath);
    await rm(target, { recursive: true, force: true });
    for (const file of [...this.seen.keys()]) if (file.startsWith(target)) this.seen.delete(file);
  }

  private threadDir(threadId: string): string {
    return join(this.root, encodeURIComponent(threadId));
  }

  private fileOf(threadId: string, subpath: string | undefined): string {
    const dir = this.threadDir(threadId);
    return subpath === undefined ? join(dir, MAIN_FILE) : join(dir, SUBPATH_DIR, `${encodeURIComponent(subpath)}${SUFFIX}`);
  }
}

/** A transcript file as read (the header); `null` when it does not exist. */
interface ReadTranscript {
  readonly entries: SessionStoreEntry[];
  /** Whether the file ends in a write a crash cut short. */
  readonly torn: boolean;
  /** The bytes up to and including the last complete line. */
  readonly completeBytes: number;
}

async function readTranscript(file: string): Promise<ReadTranscript | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  const completeBytes = bytes.lastIndexOf(0x0a) + 1;
  const entries = bytes
    .subarray(0, completeBytes)
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as SessionStoreEntry);
  return { entries, torn: completeBytes < bytes.length, completeBytes };
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
