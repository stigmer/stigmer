/**
 * The turn's skill and plugin files, read from the store one file at a time
 * (`SkillQueryController.listFiles` / `readFile` and their plugin twins)
 * instead of unpacked from a downloaded archive. The Stigmer engine's file
 * tools read a skill through it in every conversation
 * (`execute-deep-agent/store-content-backend.ts`), so a turn moves only the
 * bytes the model opens: a 4 KB instruction file of a 50 MB plugin costs
 * about 4 KB.
 *
 * What a turn may read is its own skills and plugins and nothing else: the
 * sources the turn resolved (the root's, its hooks' plugins', each saved
 * subagent's; `harness/turn-context.ts`), each at the exact version the
 * turn resolved, under the path its prompt names (`skills/<name>/…`,
 * `plugins/<digest>/…`, relative to the platform folder). A path under no
 * source is not found, whatever the server would allow.
 *
 * Every server call is made inside the turn's own async context (directly
 * in-process, or through `agent-host/remote-adapter.ts` `withinTurn` for the
 * agent host's calls), so it carries that turn's run credential, bound to
 * the run's organization (`client/stigmer-client.ts`), with none passed by
 * hand; the server then asks `can_view` on the skill or plugin.
 *
 * A skill's `SKILL.md` is its spec's text, as the mount writes it, so the
 * file a prompt names first costs no read; a plugin's skills have no spec,
 * so theirs is read like any other file.
 *
 * Listings and file bytes sit in one process-wide cache bounded by bytes
 * ({@link DEFAULT_ARCHIVE_CACHE_BYTES}, `STIGMER_RUNNER_ARCHIVE_CACHE_BYTES`).
 * Every key carries the run's organization, so no turn is served from an
 * entry another organization's turn filled: file bytes by organization and
 * SHA-256, listings by organization, kind, id and version. Every byte is
 * checked against the listing's SHA-256 before it is cached or returned; a
 * mismatch is an error, never served.
 *
 * Each turn logs one line: the files it read, the bytes it received, the
 * reads the cache answered ({@link TurnArchives.report}).
 */

import { createHash } from "node:crypto";

import { LRUCache } from "lru-cache";

import type { StigmerClient } from "../client/stigmer-client.js";

/** One file of the turn's skills and plugins, by its path under the platform folder. */
export interface ArchiveFileInfo {
  /** `skills/<name>/<path>` or `plugins/<digest>/<path>`, forward slashes. */
  readonly path: string;
  readonly size: number;
  /** SHA-256 of the file's bytes, lowercase hex. */
  readonly sha256: string;
  readonly executable: boolean;
}

/** The platform folder's folders whose files the store serves. */
export type ArchiveFolder = "skills" | "plugins";

/** What the engine's file tools read the turn's skills and plugins through. */
export interface TurnArchiveFiles {
  /** The folders the turn has files in: `skills` when it has a skill, `plugins` when it has a plugin. */
  readonly folders: readonly ArchiveFolder[];
  /** Every file of the turn's skills and plugins. */
  list(): Promise<readonly ArchiveFileInfo[]>;
  /** One file's verified bytes; {@link ArchiveFileNotFoundError} when the turn holds no such file. */
  read(path: string): Promise<Uint8Array>;
}

/** A path the turn's skills and plugins do not hold. */
export class ArchiveFileNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`'${path}' is not a file of this turn's skills or plugins`);
    this.name = "ArchiveFileNotFoundError";
  }
}

/** One skill or plugin a turn reads, at the version it resolved. */
export type ArchiveSource =
  | {
      readonly kind: "skill";
      /** `skills/<name>`: where the prompt names it under the platform folder. */
      readonly dir: string;
      readonly id: string;
      /** The resolved version hash; empty for a head whose version failed to archive (its stored archive is read). */
      readonly version: string;
      /** Whether the skill has an archive at all; a skill without one is its `SKILL.md` alone. */
      readonly hasArchive: boolean;
      /** `spec.skill_md`, served as the skill's `SKILL.md`. */
      readonly skillMd: string;
    }
  | {
      readonly kind: "plugin";
      /** `plugins/<digest>`. */
      readonly dir: string;
      readonly id: string;
      readonly digest: string;
    };

/** The process-wide cache's default size. */
export const DEFAULT_ARCHIVE_CACHE_BYTES = 64 * 1024 * 1024;

/** The variable that sizes the cache, in bytes. */
export const ARCHIVE_CACHE_BYTES_ENV = "STIGMER_RUNNER_ARCHIVE_CACHE_BYTES";

type Cached = Uint8Array | readonly ArchiveFileInfo[];

/** A byte-bounded cache of listings and file bytes, shared by every turn of the process. */
export type ArchiveCache = LRUCache<string, Cached>;

export function newArchiveCache(maxBytes: number): ArchiveCache {
  return new LRUCache<string, Cached>({
    maxSize: maxBytes,
    sizeCalculation: (value) => Math.max(1, value instanceof Uint8Array ? value.length : value.length * 160),
  });
}

let processCache: ArchiveCache | undefined;

/** The process's one cache, sized by {@link ARCHIVE_CACHE_BYTES_ENV}. */
export function processArchiveCache(): ArchiveCache {
  const configured = Number(process.env[ARCHIVE_CACHE_BYTES_ENV]);
  processCache ??= newArchiveCache(Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_ARCHIVE_CACHE_BYTES);
  return processCache;
}

/** What one turn's reads cost. */
export interface ArchiveReadReport {
  readonly filesRead: number;
  readonly bytesReceived: number;
  readonly cacheHits: number;
}

/** The turn's reader: its files, and what reading them cost. */
export interface TurnArchives extends TurnArchiveFiles {
  readonly sources: readonly ArchiveSource[];
  report(): ArchiveReadReport;
}

/** The reader over the server calls it makes, so a test can count them. */
export type ArchiveFileClient = Pick<StigmerClient, "listSkillFiles" | "readSkillFile" | "listPluginFiles" | "readPluginFile">;

/**
 * The turn's reader over `sources`, for a turn of organization `org` (the
 * run's: what its credential reaches). Of two sources under one directory
 * the later wins, as the later mount overwrote the earlier.
 */
export function newTurnArchives(
  client: ArchiveFileClient,
  org: string,
  sources: readonly ArchiveSource[],
  cache: ArchiveCache = processArchiveCache(),
): TurnArchives {
  const byDir = new Map<string, ArchiveSource>();
  for (const source of sources) byDir.set(source.dir, source);
  const stats = { filesRead: 0, bytesReceived: 0, cacheHits: 0 };

  async function listingOf(source: ArchiveSource): Promise<readonly ArchiveFileInfo[]> {
    if (source.kind === "skill" && !source.hasArchive) return [skillMdInfo(source)];
    const version = source.kind === "skill" ? source.version : source.digest;
    const key = `listing:${org}:${source.kind}:${source.id}:${version}`;
    // A head read by an empty version may move, so only a named version is kept.
    const cached = version === "" ? undefined : cache.get(key);
    if (Array.isArray(cached)) return cached as readonly ArchiveFileInfo[];
    const wire =
      source.kind === "skill" ? await client.listSkillFiles(source.id, source.version) : await client.listPluginFiles(source.id, source.digest);
    let files = wire.files.map(
      (file): ArchiveFileInfo => ({ path: `${source.dir}/${file.path}`, size: Number(file.sizeBytes), sha256: file.sha256, executable: file.executable }),
    );
    if (source.kind === "skill") {
      const skillMd = `${source.dir}/SKILL.md`;
      files = [skillMdInfo(source), ...files.filter((file) => file.path !== skillMd)];
    }
    if (version !== "") cache.set(key, files);
    return files;
  }

  function sourceOf(path: string): ArchiveSource | undefined {
    const [top, name] = path.split("/", 2);
    return top === undefined || name === undefined ? undefined : byDir.get(`${top}/${name}`);
  }

  const folders = new Set<ArchiveFolder>([...byDir.values()].map((source) => (source.kind === "skill" ? "skills" : "plugins")));
  return {
    sources: [...byDir.values()],
    folders: (["skills", "plugins"] as const).filter((folder) => folders.has(folder)),

    async list() {
      const all: ArchiveFileInfo[] = [];
      for (const source of byDir.values()) all.push(...(await listingOf(source)));
      return all;
    },

    async read(path) {
      const source = sourceOf(path);
      if (source === undefined) throw new ArchiveFileNotFoundError(path);
      if (source.kind === "skill" && path === `${source.dir}/SKILL.md`) return new TextEncoder().encode(source.skillMd);
      const file = (await listingOf(source)).find((candidate) => candidate.path === path);
      if (file === undefined) throw new ArchiveFileNotFoundError(path);

      const key = `file:${org}:${file.sha256}`;
      const cached = cache.get(key);
      if (cached instanceof Uint8Array) {
        stats.cacheHits += 1;
        return cached;
      }
      const inner = path.slice(source.dir.length + 1);
      const bytes =
        source.kind === "skill"
          ? await client.readSkillFile(source.id, source.version, inner)
          : await client.readPluginFile(source.id, source.digest, inner);
      stats.filesRead += 1;
      stats.bytesReceived += bytes.length;
      if (sha256Hex(bytes) !== file.sha256) {
        throw new Error(`'${path}' does not match its listed SHA-256; it was not served`);
      }
      cache.set(key, bytes);
      return bytes;
    },

    report: () => ({ ...stats }),
  };
}

/** The one line a turn logs of its reads. */
export function archiveReadLine(executionId: string, report: ArchiveReadReport): string {
  return `[archive-reader] execution=${executionId} filesRead=${report.filesRead} bytesReceived=${report.bytesReceived} cacheHits=${report.cacheHits}`;
}

function skillMdInfo(source: Extract<ArchiveSource, { kind: "skill" }>): ArchiveFileInfo {
  const bytes = new TextEncoder().encode(source.skillMd);
  return { path: `${source.dir}/SKILL.md`, size: bytes.length, sha256: sha256Hex(bytes), executable: false };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
