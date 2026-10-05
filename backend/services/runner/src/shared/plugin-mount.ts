/**
 * Plugin mount — a referenced plugin's archive as a directory tree its hooks
 * run from (`${CLAUDE_PLUGIN_ROOT}`), kept equal to the verified archive for
 * as long as the turn runs.
 *
 * Where it lands, under the session's platform dir:
 *
 *   plugins/<digest>.zip   the archive, cached across the session's turns
 *   plugins/<digest>/      the tree a hook runs from
 *   plugin-data/<slug>/    `${CLAUDE_PLUGIN_DATA}`, kept across turns
 *
 * The cache is content-addressed by the plugin's `status.digest`, the
 * server's SHA-256 of the archive it installed. A cached archive is used
 * only when its own SHA-256 equals that digest; anything else is fetched
 * again (`archive-mount.ts`) and verified the same way, and an archive that
 * cannot be fetched or verified throws, which refuses the turn: a hook that
 * silently does not run is a policy that vanished. This deliberately differs
 * from a skill, whose failed download degrades to `SKILL.md` alone.
 *
 * The tamper guard. The agent's shell runs as the same user as the runner,
 * and the platform dir is reachable from the workspace, so the shell can
 * rewrite anything under it, a marker file included. The reference copy
 * therefore lives in the runner's memory: the verified archive's bytes and a
 * table of every entry's size, SHA-256 and mode. {@link PluginTree.verify}
 * runs before each hook run: it `lstat`s the tree, re-hashes only the files
 * whose size, mode, inode or change time moved since the last check, and
 * rebuilds the whole tree from the archive in memory on any difference (an
 * edited, added, removed or replaced file). What it cannot stop is an
 * interpreter on `PATH` replaced by the shell; that wall is the sandbox's.
 *
 * Turns of one workspace are serialised (`harness/turn-context.ts`
 * `acquireWorkspaceTurnLock`), so no two turns mount one tree at once; within
 * a turn, concurrent hook runs share one check in flight.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { StigmerClient } from "../client/stigmer-client.js";
import { archiveFileMode, downloadArchive, entryPathIn, resetDirectory, writeArchiveEntries } from "./archive-mount.js";
import { extractZipFileEntries, type ZipFileEntry } from "./zip-extract.js";

/** Subdirectory of the platform dir holding plugin archives and trees. */
export const PLUGINS_SUBDIR = "plugins";

/** Subdirectory of the platform dir holding each plugin's `${CLAUDE_PLUGIN_DATA}`. */
export const PLUGIN_DATA_SUBDIR = "plugin-data";

const ARCHIVE_LABEL = "plugin archive";

/** One mounted plugin, as a hook run reads it. */
export interface MountedPlugin {
  /** The plugin's slug, the name a run records as the deciding hook. */
  readonly slug: string;
  /** The plugin's own name (its manifest's), as Claude Code names its servers. */
  readonly name: string;
  /** `${CLAUDE_PLUGIN_ROOT}`. */
  readonly root: string;
  /** `${CLAUDE_PLUGIN_DATA}`. */
  readonly data: string;
  /** Bring the tree back to the verified archive if anything changed it; run before every hook run. */
  readonly verify: () => Promise<void>;
}

/** A plugin that cannot be mounted; its message names the plugin. */
export class PluginMountError extends Error {
  constructor(slug: string, detail: string) {
    super(`the plugin '${slug}' could not be mounted: ${detail}`);
    this.name = "PluginMountError";
  }
}

/** What the guard records of one file on disk, to tell cheaply whether it moved. */
interface StatSignature {
  readonly size: number;
  readonly mode: number;
  readonly ino: number;
  readonly ctimeMs: number;
  readonly mtimeMs: number;
}

/** What the verified archive says one file is. */
interface ExpectedFile {
  readonly size: number;
  readonly sha256: string;
  readonly mode: number;
}

/**
 * The one permission bit the guard holds the tree to: whether the owner may
 * run the file. The rest follow the process umask, which is not the
 * archive's to decide, so comparing them would rebuild forever under a
 * strict umask.
 */
const OWNER_EXEC = 0o100;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Mount a referenced plugin for this turn: its archive cached and verified,
 * its tree equal to the archive, its data directory present. Throws
 * {@link PluginMountError} when any of that cannot be done.
 */
export async function mountPlugin(
  client: StigmerClient,
  plugin: Plugin,
  platformDir: string,
): Promise<MountedPlugin> {
  const slug = plugin.metadata?.slug ?? "";
  const digest = plugin.status?.digest ?? "";
  const storageKey = plugin.status?.artifactStorageKey ?? "";
  if (digest === "" || storageKey === "") {
    throw new PluginMountError(slug, "it records no installed archive");
  }

  const pluginsDir = join(platformDir, PLUGINS_SUBDIR);
  await mkdir(pluginsDir, { recursive: true });
  const archive = await cachedArchive(client, join(pluginsDir, `${digest}.zip`), digest, storageKey, slug);
  const entries = await extractZipFileEntries(archive);
  if (entries.length === 0) {
    throw new PluginMountError(slug, "its archive holds no files");
  }

  const tree = new PluginTree(join(pluginsDir, digest), entries);
  await tree.verify();

  const data = join(platformDir, PLUGIN_DATA_SUBDIR, slug);
  await mkdir(data, { recursive: true });

  return {
    slug,
    name: plugin.metadata?.name || slug,
    root: tree.root,
    data,
    verify: () => tree.verify(),
  };
}

/** The archive's bytes, from the session's cache when they still hash to `digest`, else fetched, verified and cached. */
async function cachedArchive(
  client: StigmerClient,
  archivePath: string,
  digest: string,
  storageKey: string,
  slug: string,
): Promise<Uint8Array> {
  const cached = await readFile(archivePath).then(
    (bytes) => new Uint8Array(bytes),
    () => undefined,
  );
  if (cached !== undefined && sha256Hex(cached) === digest) return cached;

  let fetched: Uint8Array | undefined;
  try {
    fetched = await downloadArchive(
      {
        mintDownloadUrl: (key) => client.getPluginArtifactDownloadUrl(key),
        fetchUnary: (key) => client.getPluginArtifact(key),
      },
      storageKey,
    );
  } catch (err) {
    throw new PluginMountError(slug, `its archive could not be fetched (${err instanceof Error ? err.message : String(err)})`);
  }
  if (fetched === undefined) {
    throw new PluginMountError(slug, "the server holds no archive for it");
  }
  if (sha256Hex(fetched) !== digest) {
    throw new PluginMountError(slug, "the fetched archive does not match the installed version's digest");
  }
  await writeFile(archivePath, fetched);
  return fetched;
}

/**
 * A plugin's tree and the in-memory reference it is held to. Exported for
 * the guard's own tests; every other caller goes through {@link mountPlugin}.
 */
export class PluginTree {
  private readonly expected: ReadonlyMap<string, ExpectedFile>;
  private readonly seen = new Map<string, StatSignature>();
  private inFlight: Promise<void> | undefined;

  constructor(
    readonly root: string,
    private readonly entries: readonly ZipFileEntry[],
  ) {
    const expected = new Map<string, ExpectedFile>();
    for (const entry of entries) {
      const path = relative(root, entryPathIn(root, entry.path, ARCHIVE_LABEL));
      expected.set(path, {
        size: entry.content.length,
        sha256: sha256Hex(entry.content),
        mode: archiveFileMode(entry.path, entry.content),
      });
    }
    this.expected = expected;
  }

  /**
   * Hold the tree to the archive: a check that hashes only what moved, and
   * a rebuild on any difference. Concurrent callers share one check.
   */
  verify(): Promise<void> {
    this.inFlight ??= this.check().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async check(): Promise<void> {
    if (await this.matches()) return;
    if (existsSync(this.root)) {
      console.warn(`[plugin-mount] ${this.root} differs from its verified archive; rebuilding it`);
    }
    await this.rebuild();
  }

  /** Whether the tree on disk is exactly the archive; records each file's signature as it goes. */
  private async matches(): Promise<boolean> {
    const onDisk = await this.listFiles();
    if (onDisk === undefined || onDisk.size !== this.expected.size) return false;
    for (const [path, signature] of onDisk) {
      const expected = this.expected.get(path);
      if (expected === undefined) return false;
      if (signature.size !== expected.size || (signature.mode & OWNER_EXEC) !== (expected.mode & OWNER_EXEC)) return false;
      const last = this.seen.get(path);
      if (last !== undefined && sameSignature(last, signature)) continue;
      const bytes = await readFile(join(this.root, path)).catch(() => undefined);
      if (bytes === undefined || sha256Hex(bytes) !== expected.sha256) return false;
      this.seen.set(path, signature);
    }
    return true;
  }

  /** Every entry under the root as a regular file's signature; `undefined` when the tree is missing or holds anything else. */
  private async listFiles(): Promise<Map<string, StatSignature> | undefined> {
    let dirents;
    try {
      dirents = await readdir(this.root, { recursive: true, withFileTypes: true });
    } catch {
      return undefined;
    }
    const files = new Map<string, StatSignature>();
    for (const dirent of dirents) {
      if (dirent.isDirectory()) continue;
      if (!dirent.isFile()) return undefined;
      const absolute = join(dirent.parentPath, dirent.name);
      const stat = await lstat(absolute).catch(() => undefined);
      if (stat === undefined || !stat.isFile()) return undefined;
      files.set(relative(this.root, absolute), {
        size: stat.size,
        mode: stat.mode,
        ino: stat.ino,
        ctimeMs: stat.ctimeMs,
        mtimeMs: stat.mtimeMs,
      });
    }
    return files;
  }

  private async rebuild(): Promise<void> {
    this.seen.clear();
    await resetDirectory(this.root);
    try {
      await writeArchiveEntries(this.root, this.entries, ARCHIVE_LABEL);
    } catch (err) {
      await rm(this.root, { recursive: true, force: true });
      throw err;
    }
    if (!(await this.matches())) {
      throw new Error(`${this.root} does not match its verified archive after a rebuild`);
    }
  }
}

function sameSignature(a: StatSignature, b: StatSignature): boolean {
  return a.size === b.size && a.mode === b.mode && a.ino === b.ino && a.ctimeMs === b.ctimeMs && a.mtimeMs === b.mtimeMs;
}
