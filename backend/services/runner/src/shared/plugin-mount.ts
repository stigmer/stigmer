/**
 * Plugin mount — a referenced plugin's archive as a directory tree its hooks
 * run from (`${CLAUDE_PLUGIN_ROOT}`), held to the verified archive before
 * each hook run.
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
 * edited, added, removed or replaced file). It is a check before the spawn,
 * not a lock: a shell call running in the same model step can still write
 * the tree between the check and the hook reading it. Neither can it stop
 * an interpreter on `PATH` replaced by the shell. Both walls are the
 * sandbox's. A hook that writes into its own tree has it rebuilt before the
 * next run, even under another of the plugin's hooks still running from it;
 * `${CLAUDE_PLUGIN_DATA}` is the plugin's writable place, and its hooks run
 * with Python's bytecode cache off (`hooks/evaluate.ts`).
 *
 * The plugin's eval suite is never mounted: `evals/`, the directory
 * `PluginStatus.evals.dir` names when the manifest moved the suite, and the
 * manifest's own `experimental.evals` read from the archive (a plugin
 * installed before the status carried the directory has none recorded),
 * under the library's rule that refuses a directory overlapping the
 * skills, are left out of the tree, so an agent under test cannot read the cases it is
 * graded on, as Claude Code hides them from its own runs. An entry is
 * judged by its cleaned, root-relative name, the name the server's suite
 * reader gives it, so `./evals/…` or `x/../evals/…` is a suite file here
 * too. Hooks never need
 * them; the suite is the eval workflow's, which reads the archive itself.
 * For the same reason an archive that carries a suite is never cached on
 * disk: the cache must hash to the digest, so it is the whole archive, and
 * the shell could unzip it. Such an archive is fetched on every turn
 * instead (plugins are small), and a cached copy an earlier runner left is
 * removed.
 *
 * Turns of one workspace are serialised (`harness/turn-context.ts`
 * `acquireWorkspaceTurnLock`), so no two turns mount one tree at once; within
 * a turn, concurrent hook runs share one check in flight.
 */

import { createHash } from "node:crypto";
import { agentFs, agentPathExists } from "./agent-fs.js";
import { join, posix, relative } from "node:path";
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
  /** The plugin's id: its hooks' values are grouped by it (`RunValues.plugins`). */
  readonly id: string;
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
  constructor(slug: string, detail: string, options?: { readonly cause?: unknown }) {
    super(`the plugin '${slug}' could not be mounted: ${detail}`, options);
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
  await agentFs().mkdir(pluginsDir, { recursive: true });
  const archivePath = join(pluginsDir, `${digest}.zip`);
  const archive = await cachedArchive(client, archivePath, digest, storageKey, slug);
  const entries = await extractZipFileEntries(archive);
  if (entries.length === 0) {
    throw new PluginMountError(slug, "its archive holds no files");
  }
  const mountable = withoutEvalSuite(entries, plugin.status?.evals?.dir, manifestEvalDir(entries));
  if (mountable.length === entries.length) {
    await agentFs().writeFile(archivePath, archive);
  } else {
    await agentFs().rm(archivePath, { force: true });
  }

  const tree = new PluginTree(join(pluginsDir, digest), mountable);
  await tree.verify();

  const data = join(platformDir, PLUGIN_DATA_SUBDIR, slug);
  await agentFs().mkdir(data, { recursive: true });

  return {
    id: plugin.metadata?.id ?? "",
    slug,
    name: plugin.metadata?.name || slug,
    root: tree.root,
    data,
    verify: () => tree.verify(),
  };
}

/** The suite's default directory; always skipped, whatever the status names. */
const DEFAULT_EVAL_DIR = "evals";

/**
 * The archive's entries minus the eval suite: everything under `evals/`,
 * and under each of `dirs` (the directory the install recorded, the one
 * the manifest names) that is set. An entry is matched by
 * {@link cleanEntryPath}, the directories are plugin-relative paths of
 * plain segments.
 */
export function withoutEvalSuite(entries: readonly ZipFileEntry[], ...dirs: readonly (string | undefined)[]): readonly ZipFileEntry[] {
  const prefixes = [DEFAULT_EVAL_DIR, ...dirs]
    .filter((dir): dir is string => dir !== undefined && dir !== "")
    .map((dir) => `${dir}/`);
  return entries.filter((entry) => {
    const path = cleanEntryPath(entry.path);
    return !prefixes.some((prefix) => path.startsWith(prefix));
  });
}

/**
 * An entry's name as the server's archive gate sanitises it before the
 * suite reader sees it (`stigmer-server` `archive/prefilter.ts`
 * `sanitizePath`): backslashes as slashes, `.` and `..` resolved against
 * the root, no leading slash.
 */
function cleanEntryPath(name: string): string {
  return posix.normalize(`/${name.replaceAll("\\", "/")}`).slice(1);
}

/**
 * The Claude-shaped manifests that may move the suite, in the order the
 * library ranks them (`@stigmer/plugin-package` `detect.ts`: the root
 * manifest is the open format's, which carries no `experimental.evals`).
 */
const SUITE_MANIFESTS = [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"] as const;

/**
 * Every manifest location a plugin may carry (`@stigmer/plugin-package`
 * `messages.ts` `MANIFEST_LOCATIONS`); an install refuses a package with
 * none of them.
 */
const PLUGIN_MANIFESTS = ["plugin.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json", ".codex-plugin/plugin.json"] as const;

/**
 * Whether an archive holds a plugin manifest, by its cleaned name. A
 * plugin's root skill is the whole package as one skill, manifests
 * included, so its archive always holds one; a skill pushed on its own
 * holds none unless its author put one there.
 */
export function holdsPluginManifest(entries: readonly ZipFileEntry[]): boolean {
  return entries.some((entry) => (PLUGIN_MANIFESTS as readonly string[]).includes(cleanEntryPath(entry.path)));
}

/** The manifests that may declare skill paths: every vendor dialect's (the open format declares none). */
const SKILL_MANIFESTS = [".claude-plugin/plugin.json", ".cursor-plugin/plugin.json", ".codex-plugin/plugin.json"] as const;

/** The open format's fixed skills directory, read whatever the manifests declare. */
const DEFAULT_SKILLS_DIR = "skills";

/**
 * The suite directory the archive's own manifest names, by the library's
 * rule (`@stigmer/plugin-package` `evals/eval-dir.ts` `resolveEvalDir`):
 * the first manifest carrying `experimental.evals` decides (an array by its
 * first entry, a `./` prefix stripped), and its value
 * is used only when it is a relative path of plain directory names that
 * does not overlap the skills (`skills/` or a declared skill path, other
 * than the plugin's root, being it, holding it or lying inside it);
 * anything else leaves `evals/` alone, as the library falls back to it, so
 * a skill is never mounted short of its own files. A manifest that does
 * not parse contributes nothing, as the library reads it. Parsed here
 * rather than through the library, which the runner does not depend on (it
 * would bring its YAML and ZIP dependencies into every runner build for
 * two fields).
 */
export function manifestEvalDir(entries: readonly ZipFileEntry[]): string | undefined {
  for (const location of SUITE_MANIFESTS) {
    const manifest = manifestObject(entries, location);
    const experimental = manifest?.["experimental"];
    const value = isObject(experimental) ? experimental["evals"] : undefined;
    if (value === undefined) continue;
    const dir = declaredEvalDir(value);
    if (dir === undefined) return undefined;
    const skillDirs = [DEFAULT_SKILLS_DIR, ...declaredSkillDirs(entries)];
    return skillDirs.some((skillDir) => skillDir !== "" && pathsOverlap(dir, skillDir)) ? undefined : dir;
  }
  return undefined;
}

/** The library's `EVAL_DIR_MAX_LENGTH`: the longest suite directory a manifest may name, in UTF-16 code units. */
const EVAL_DIR_MAX_LENGTH = 1024;

/**
 * The library's `declaredEvalDir`: an array's first entry, one `./`
 * stripped, a plain relative path no longer than
 * {@link EVAL_DIR_MAX_LENGTH}, or `undefined`.
 */
function declaredEvalDir(value: unknown): string | undefined {
  const entry: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof entry !== "string") return undefined;
  const path = entry.startsWith("./") ? entry.slice(2) : entry;
  return path.length <= EVAL_DIR_MAX_LENGTH && isPlainRelativePath(path) ? path : undefined;
}

/** A manifest of the archive as a JSON object; `undefined` when absent, unreadable or not an object. */
function manifestObject(entries: readonly ZipFileEntry[], location: string): Record<string, unknown> | undefined {
  const entry = entries.find((candidate) => cleanEntryPath(candidate.path) === location);
  if (entry === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(entry.content));
  } catch {
    return undefined;
  }
  return isObject(parsed) ? parsed : undefined;
}

/**
 * Every skill path the vendor manifests declare, by the library's declared
 * path rule (`dialects/manifest.ts` `readDeclaredPaths`): a string or an
 * array of strings, each `./`-relative, `""` for the root; a value the
 * library would refuse names nothing.
 */
function declaredSkillDirs(entries: readonly ZipFileEntry[]): readonly string[] {
  return SKILL_MANIFESTS.flatMap((location) => {
    const skills = manifestObject(entries, location)?.["skills"];
    const values = typeof skills === "string" ? [skills] : Array.isArray(skills) && skills.every((v) => typeof v === "string") ? skills : [];
    return values.flatMap((value: string) => {
      const path = declaredPath(value);
      return path === undefined ? [] : [path];
    });
  });
}

/** The library's `resolveDeclaredPath`: the plugin-relative path, or `undefined` when it would refuse the value. */
function declaredPath(value: string): string | undefined {
  if (/[*?[\]{}]/.test(value)) return undefined;
  if (!value.startsWith("./") && value !== ".") return undefined;
  const trimmed = trimTrailingSlashes(value.slice(2));
  if (trimmed === "") return "";
  return isPlainRelativePath(trimmed) ? trimmed : undefined;
}

/**
 * `value` without its trailing slashes: the library's `trimTrailing`
 * (`@stigmer/plugin-package` `trim.ts`), copied since the runner does not
 * depend on the library. A `/\/+$/` regex rescans the run from every
 * starting position, quadratic in a long run a manifest can carry; this
 * walks it once.
 */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

/** Whether one plugin-relative directory is the other or lies inside it. */
function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The library's `isContainedPath`: relative, forward slashes, no empty, `.` or `..` segment. */
function isPlainRelativePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * The archive's bytes, from the session's cache when they still hash to
 * `digest`, else fetched and verified. The caller decides whether to cache
 * them ({@link mountPlugin}: never an archive carrying an eval suite).
 */
async function cachedArchive(
  client: StigmerClient,
  archivePath: string,
  digest: string,
  storageKey: string,
  slug: string,
): Promise<Uint8Array> {
  const cached = await agentFs().readFile(archivePath).then(
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
    throw new PluginMountError(slug, `its archive could not be fetched (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
  if (fetched === undefined) {
    throw new PluginMountError(slug, "the server holds no archive for it");
  }
  if (sha256Hex(fetched) !== digest) {
    throw new PluginMountError(slug, "the fetched archive does not match the installed version's digest");
  }
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
    if (await this.intact()) return;
    if (await agentPathExists(this.root)) {
      console.warn(`[plugin-mount] ${this.root} differs from its verified archive; rebuilding it`);
    }
    await this.rebuild();
  }

  /**
   * Whether the tree on disk is exactly the archive. Anything that fails
   * while reading it (the tree missing, a file the shell removed between the
   * listing and its read) is a difference.
   */
  private async intact(): Promise<boolean> {
    try {
      return await this.matches();
    } catch {
      return false;
    }
  }

  /** The comparison itself; records each file's signature as it goes, and throws when the tree cannot be read. */
  private async matches(): Promise<boolean> {
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

  /** Every entry under the root as a regular file's signature; `undefined` when it holds anything but files and directories. */
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
   * Write the archive's files afresh. A write that fails leaves a partial
   * tree the next check rebuilds; a tree that still differs once written
   * (a filesystem that folds two names into one, say) refuses, because a
   * hook would run from something other than the archive.
   */
  private async rebuild(): Promise<void> {
    this.seen.clear();
    await resetDirectory(this.root);
    await writeArchiveEntries(this.root, this.entries, ARCHIVE_LABEL);
    if (!(await this.intact())) {
      throw new Error(`${this.root} does not match its verified archive after a rebuild`);
    }
  }
}

function sameSignature(a: StatSignature, b: StatSignature): boolean {
  return a.size === b.size && a.mode === b.mode && a.ino === b.ino && a.ctimeMs === b.ctimeMs && a.mtimeMs === b.mtimeMs;
}
