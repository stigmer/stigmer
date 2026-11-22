/**
 * A skill's or plugin's files on disk, for a conversation with a computer,
 * whose commands may run a skill's scripts or a plugin's hooks, and out of
 * the agent's reach (stigmer#2588): a command can neither change the tree
 * nor carry an edit into the next message.
 *
 * Two things that used to be one are kept apart: the archive, which must
 * survive a sandbox's sleep and so stays on the agent's volume, and the
 * tree the agent sees.
 *
 *  - The archive cache ({@link cachedArchive}): one cache for both kinds,
 *    `<platform>/archives/<sha256>.zip`, written and read through
 *    `agent-fs.ts` with the agent's rights. A cached archive is used only
 *    when its SHA-256 matches the version, so a tampered cache costs a
 *    download, never a wrong file. An archive that carries an eval suite is
 *    never cached: the cache must be the whole archive, and a command could
 *    unzip it.
 *  - The tree, where the runner separates (`agent-identity.ts`: root in a
 *    container shape, the agent's commands as uid 10001): the runner itself,
 *    as root, unpacks it into `/runner/mounts/<sessionId>/<key>/`, beside
 *    the image's root-owned `/runner/engines`. Folders are 0755, files 0644
 *    or 0755 by the shared executable rule (`@stigmer/zip-structure`), every
 *    ancestor is root-owned and closed to writes by others (checked before
 *    any write), so the runner writes nowhere the agent controls. The agent
 *    reaches the tree through a link in the platform folder (`skills/<name>`,
 *    `plugins/<digest>`), which the host makes with the agent's rights. Each
 *    turn start (and each hook run) checks the link, the tree's owner and
 *    its completion mark, and remakes what differs; the files need no
 *    re-hash, since the agent cannot write them. The image layer under
 *    `/runner` is not kept across a sandbox's sleep, so the first turn after
 *    a wake unpacks again, from the cached archive: CPU, not a download.
 *    The trees are keyed by content ({@link skillTreeKey}, `plugin-<digest>`)
 *    and per session, so no session's commands reach another's skills.
 *  - The tree, everywhere else (a person's own machine, one user): written
 *    where the link would be, through `agent-fs.ts`, and held to the archive
 *    at every turn start and hook run ({@link AgentOwnedTree}): size, mode
 *    and inode signatures, re-hashing only what moved, a rebuild on any
 *    difference. No write is refused there, but no turn starts from an
 *    edited skill.
 *
 * `releaseSessionTrees` removes a session's folder under `/runner/mounts`
 * when the session leaves the runner; `holdSessionTrees` drops the trees a
 * turn did not mount. Both run in the runner, with its own rights, on its
 * own folder.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { agentFs, agentPathExists } from "./agent-fs.js";
import { agentIdentity, currentProcessFacts, type ProcessFacts } from "./agent-identity.js";
import { archiveFileMode, entryPathIn, resetDirectory, writeArchiveEntries } from "./archive-mount.js";
import type { ZipFileEntry } from "./zip-extract.js";

/** Subdirectory of the platform dir holding the cached archives of both kinds. */
export const ARCHIVES_SUBDIR = "archives";

/** Where a separating runner unpacks trees: beside the image's root-owned `/runner/engines`. */
export const RUNNER_MOUNTS_DIR = "/runner/mounts";

/** Names another folder for the trees, for a test that cannot write `/runner`. */
export const RUNNER_MOUNTS_DIR_ENV = "STIGMER_RUNNER_MOUNTS_DIR";

/** The folder a separating runner unpacks trees under, or `undefined` where the runner does not separate. */
export function runnerMountsRoot(facts: ProcessFacts = currentProcessFacts()): string | undefined {
  if (agentIdentity(facts) === null) return undefined;
  return facts.env[RUNNER_MOUNTS_DIR_ENV]?.trim() || RUNNER_MOUNTS_DIR;
}

/** A session's folder of runner-owned trees, or `undefined` where the runner does not separate. */
export function sessionTreesDir(sessionId: string, facts?: ProcessFacts): string | undefined {
  const root = runnerMountsRoot(facts);
  return root === undefined ? undefined : join(root, sessionId);
}

/** Fetched archive bytes that do not hash to the version they were fetched for: never used, never cached. */
export class ArchiveMismatchError extends Error {
  constructor() {
    super("the fetched archive does not match its version's SHA-256");
    this.name = "ArchiveMismatchError";
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The cache file of the archive with this content hash. */
export function cachedArchivePath(platformDir: string, sha256: string): string {
  return join(platformDir, ARCHIVES_SUBDIR, `${sha256}.zip`);
}

/**
 * The archive with content hash `sha256`: from the session's cache when it
 * still hashes to it, else `fetch`ed and verified. `undefined` when the
 * server holds no bytes; throws {@link ArchiveMismatchError} when the
 * fetched bytes do not verify. The
 * caller decides whether to keep it ({@link keepArchive}).
 */
export async function cachedArchive(
  platformDir: string,
  sha256: string,
  fetch: () => Promise<Uint8Array | undefined>,
): Promise<Uint8Array | undefined> {
  const path = cachedArchivePath(platformDir, sha256);
  const cached = await agentFs().readFile(path).then(
    (bytes) => new Uint8Array(bytes),
    () => undefined,
  );
  if (cached !== undefined && sha256Hex(cached) === sha256) return cached;
  const fetched = await fetch();
  if (fetched === undefined) return undefined;
  if (sha256Hex(fetched) !== sha256) throw new ArchiveMismatchError();
  return fetched;
}

/**
 * Keep a verified archive in the session's cache, or remove a cached copy
 * when `cacheable` is false (an archive carrying an eval suite, the header).
 */
export async function keepArchive(platformDir: string, sha256: string, archive: Uint8Array, cacheable: boolean): Promise<void> {
  const path = cachedArchivePath(platformDir, sha256);
  if (!cacheable) {
    await agentFs().rm(path, { force: true });
    return;
  }
  await agentFs().mkdir(dirname(path), { recursive: true });
  await agentFs().writeFile(path, archive);
}

/** A skill's tree key: its archive and the spec text its `SKILL.md` is written from. */
export function skillTreeKey(archiveSha256: string | undefined, skillMd: string): string {
  return `skill-${createHash("sha256").update(`${archiveSha256 ?? "none"}\n`).update(skillMd).digest("hex")}`;
}

/** A plugin's tree key: its archive. */
export function pluginTreeKey(digest: string): string {
  return `plugin-${digest}`;
}

/** A tree the agent reaches at {@link root}, held to its archive by {@link verify}. */
export interface ArchiveTree {
  /** Where the agent reaches the tree: the platform folder's link, or the tree itself where the runner does not separate. */
  readonly root: string;
  /** The tree's content key; a separating runner's folder name. */
  readonly key: string;
  /** Bring the tree back to its archive if anything changed it; run at every turn start and before every hook run. */
  verify(): Promise<void>;
}

/**
 * Place the tree of `entries` for the agent at `linkPath` (the header):
 * runner-owned with a link where the runner separates, agent-owned and
 * re-verified elsewhere. Verified once before it returns.
 */
export async function placeArchiveTree(args: {
  readonly linkPath: string;
  readonly sessionId: string;
  readonly key: string;
  readonly entries: readonly ZipFileEntry[];
  readonly label: string;
}): Promise<ArchiveTree> {
  const root = runnerMountsRoot();
  const tree: ArchiveTree =
    root === undefined
      ? new AgentOwnedTree(args.linkPath, args.entries, args.label, args.key)
      : new RunnerOwnedTree(args.linkPath, root, join(root, args.sessionId), args.key, args.entries, args.label);
  await tree.verify();
  return tree;
}

/**
 * A separating runner's tree (the header): unpacked by the runner as root
 * under `/runner/mounts/<session>/<key>/`, reached through a link the host
 * makes. `owner` is the uid every folder it writes in must belong to: root
 * in a runner; the test's own user in its unit tests, which cannot run as
 * root (the container test proves root's). Exported for its own tests.
 */
export class RunnerOwnedTree implements ArchiveTree {
  private inFlight: Promise<void> | undefined;

  constructor(
    readonly root: string,
    private readonly mountsRoot: string,
    private readonly sessionDir: string,
    readonly key: string,
    private readonly entries: readonly ZipFileEntry[],
    private readonly label: string,
    private readonly owner: number = 0,
  ) {}

  /** The folder the files are in. */
  get treeDir(): string {
    return join(this.sessionDir, this.key);
  }

  verify(): Promise<void> {
    this.inFlight ??= this.check().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async check(): Promise<void> {
    await ensureRunnerOwnedDir(this.sessionDir, this.mountsRoot, this.owner);
    if (!(await this.unpacked())) await this.unpack();
    await this.link();
  }

  /** Whether the tree is complete and root's: its mark is present and its folder is a root-owned folder, not a link. */
  private async unpacked(): Promise<boolean> {
    try {
      const [mark, dir] = await Promise.all([fs.lstat(this.markPath()), fs.lstat(this.treeDir)]);
      return mark.isFile() && dir.isDirectory() && dir.uid === this.owner && (dir.mode & 0o022) === 0;
    } catch {
      return false;
    }
  }

  /** Write the tree afresh, as root; the completion mark last, so a crash mid-write leaves none. */
  private async unpack(): Promise<void> {
    await fs.rm(this.markPath(), { force: true });
    await fs.rm(this.treeDir, { recursive: true, force: true });
    await fs.mkdir(this.treeDir, { mode: 0o755 });
    for (const entry of this.entries) {
      const filePath = entryPathIn(this.treeDir, entry.path, this.label);
      await fs.mkdir(dirname(filePath), { recursive: true, mode: 0o755 });
      await fs.writeFile(filePath, entry.content, { mode: archiveFileMode(entry.path, entry.content) });
    }
    await fs.writeFile(this.markPath(), "", { mode: 0o644 });
  }

  /** The agent's link to the tree, remade by the host when it is anything else. */
  private async link(): Promise<void> {
    try {
      const stat = await agentFs().lstat(this.root);
      if (stat.isSymbolicLink() && (await agentFs().readlink(this.root)) === this.treeDir) return;
    } catch {
      // Absent: made below.
    }
    await agentFs().rm(this.root, { recursive: true, force: true });
    await agentFs().mkdir(dirname(this.root), { recursive: true });
    await agentFs().symlink(this.treeDir, this.root);
  }

  private markPath(): string {
    return `${this.treeDir}.complete`;
  }
}

/**
 * Make `dir` and hold it, and every ancestor up to the mounts root's parent,
 * to what a runner-owned tree needs: real folders (never a link), owned by
 * `owner` (root), closed to writes by anyone else. A folder that is not
 * refuses: the runner would otherwise write where someone else could rename
 * or plant.
 */
async function ensureRunnerOwnedDir(dir: string, mountsRoot: string, owner: number): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o755 });
  const stop = dirname(mountsRoot);
  for (let current = dir; ; current = dirname(current)) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== owner || (stat.mode & 0o022) !== 0) {
      throw new Error(`${current} is not a folder of the runner's own, closed to others; the runner writes no skill there`);
    }
    if (current === stop || dirname(current) === current) return;
  }
}

/**
 * Drop every runner-owned tree of the session that `keep` does not name,
 * with the runner's own rights. Nothing where the runner does not separate.
 */
export async function holdSessionTrees(sessionId: string, keep: readonly string[], facts?: ProcessFacts): Promise<void> {
  const dir = sessionTreesDir(sessionId, facts);
  if (dir === undefined) return;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const kept = new Set(keep.flatMap((key) => [key, `${key}.complete`]));
  for (const name of names) {
    if (!kept.has(name)) await fs.rm(join(dir, name), { recursive: true, force: true });
  }
}

/** Remove the session's runner-owned trees: it has left this runner. Logged, never thrown: the session is already gone. */
export async function releaseSessionTrees(sessionId: string, facts?: ProcessFacts): Promise<void> {
  const dir = sessionTreesDir(sessionId, facts);
  if (dir === undefined) return;
  await fs.rm(dir, { recursive: true, force: true }).catch((err: unknown) => {
    console.error(`[archive-tree] removing the skill trees of session ${sessionId} failed (continuing): ${err instanceof Error ? err.message : String(err)}`);
  });
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

/**
 * A tree where the runner does not separate (the header): written through
 * `agent-fs.ts` and held to the archive in memory. {@link verify} `lstat`s
 * the tree, re-hashes only the files whose size, mode, inode or change time
 * moved since the last check, and rebuilds the whole tree on any difference
 * (an edited, added, removed or replaced file). It is a check, not a lock: a
 * command running in the same model step can still write the tree between
 * the check and a hook reading it, and nothing stops the next one. Exported
 * for its own tests.
 */
export class AgentOwnedTree implements ArchiveTree {
  private readonly expected: ReadonlyMap<string, ExpectedFile>;
  private readonly seen = new Map<string, StatSignature>();
  private inFlight: Promise<void> | undefined;

  constructor(
    readonly root: string,
    private readonly entries: readonly ZipFileEntry[],
    private readonly label: string,
    readonly key: string = "",
  ) {
    const expected = new Map<string, ExpectedFile>();
    for (const entry of entries) {
      const path = relative(root, entryPathIn(root, entry.path, label));
      expected.set(path, {
        size: entry.content.length,
        sha256: sha256Hex(entry.content),
        mode: archiveFileMode(entry.path, entry.content),
      });
    }
    this.expected = expected;
  }

  /** Hold the tree to the archive; concurrent callers share one check. */
  verify(): Promise<void> {
    this.inFlight ??= this.check().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async check(): Promise<void> {
    if (await this.intact()) return;
    if (await agentPathExists(this.root)) {
      console.warn(`[archive-tree] ${this.root} differs from its verified archive; rebuilding it`);
    }
    await this.rebuild();
  }

  /** Whether the tree on disk is exactly the archive; anything that fails while reading it is a difference. */
  private async intact(): Promise<boolean> {
    try {
      return await this.matches();
    } catch {
      return false;
    }
  }

  private async matches(): Promise<boolean> {
    const root = await agentFs().lstat(this.root);
    if (!root.isDirectory()) return false;
    const onDisk = await this.listFiles();
    if (onDisk === undefined || onDisk.size !== this.expected.size) return false;
    for (const [path, signature] of onDisk) {
      const expected = this.expected.get(path);
      if (expected === undefined) return false;
      if (signature.size !== expected.size || (signature.mode & OWNER_EXEC) !== (expected.mode & OWNER_EXEC)) return false;
      const last = this.seen.get(path);
      if (last !== undefined && sameSignature(last, signature)) continue;
      if (sha256Hex(await agentFs().readFile(join(this.root, path))) !== expected.sha256) return false;
      this.seen.set(path, signature);
    }
    return true;
  }

  /** Every entry under the root as a regular file's signature; `undefined` when it holds anything but files and folders. */
  private async listFiles(): Promise<Map<string, StatSignature> | undefined> {
    const files = new Map<string, StatSignature>();
    for (const dirent of await agentFs().readdir(this.root, { recursive: true })) {
      if (dirent.isDirectory()) continue;
      if (!dirent.isFile()) return undefined;
      const absolute = join(dirent.parentPath, dirent.name);
      const stat = await agentFs().lstat(absolute);
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

  /**
   * Write the archive's files afresh. A tree that still differs once
   * written (a filesystem that folds two names into one, say) refuses: a
   * hook would run from something other than the archive.
   */
  private async rebuild(): Promise<void> {
    this.seen.clear();
    await resetDirectory(this.root);
    await writeArchiveEntries(this.root, this.entries, this.label);
    if (!(await this.intact())) {
      throw new Error(`${this.root} does not match its verified archive after a rebuild`);
    }
  }
}

function sameSignature(a: StatSignature, b: StatSignature): boolean {
  return a.size === b.size && a.mode === b.mode && a.ino === b.ino && a.ctimeMs === b.ctimeMs && a.mtimeMs === b.mtimeMs;
}
