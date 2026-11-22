/**
 * Plugin mount — a referenced plugin's archive as a directory tree its hooks
 * run from (`${CLAUDE_PLUGIN_ROOT}`), for a conversation with a computer.
 *
 * Where it lands, under the session's platform dir:
 *
 *   archives/<digest>.zip  the archive, cached across the session's turns
 *   plugins/<digest>       the tree a hook runs from (`archive-tree.ts`)
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
 * The tree is out of the agent's reach where the runner separates: the
 * runner unpacks it as root and the agent reaches it through a link, so a
 * command or a hook is refused a write to it (`archive-tree.ts`). Elsewhere
 * it is held to the verified archive before each hook run. A hook that
 * wants to write has `${CLAUDE_PLUGIN_DATA}`, the plugin's writable place;
 * its hooks run with Python's bytecode cache off (`hooks/evaluate.ts`).
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

import { agentFs } from "./agent-fs.js";
import { join, posix } from "node:path";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { StigmerClient } from "../client/stigmer-client.js";
import { downloadArchive } from "./archive-mount.js";
import { ArchiveMismatchError, cachedArchive, keepArchive, placeArchiveTree, pluginTreeKey } from "./archive-tree.js";
import { extractZipFileEntries, type ZipFileEntry } from "./zip-extract.js";

/** Subdirectory of the platform dir holding plugin trees (or the links to them). */
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

/**
 * Mount a referenced plugin for this turn: its archive cached and verified,
 * its tree placed and held to the archive (`archive-tree.ts`), its data
 * directory present. Throws {@link PluginMountError} when any of that
 * cannot be done.
 */
export async function mountPlugin(
  client: StigmerClient,
  plugin: Plugin,
  platformDir: string,
  sessionId: string,
): Promise<MountedPlugin> {
  const slug = plugin.metadata?.slug ?? "";
  const digest = plugin.status?.digest ?? "";
  const storageKey = plugin.status?.artifactStorageKey ?? "";
  if (digest === "" || storageKey === "") {
    throw new PluginMountError(slug, "it records no installed archive");
  }

  let archive: Uint8Array | undefined;
  try {
    archive = await cachedArchive(platformDir, digest, () =>
      downloadArchive({ mintDownloadUrl: (key) => client.getPluginArtifactDownloadUrl(key) }, storageKey),
    );
  } catch (err) {
    // A mismatch is the owner's to fix (no cause, so it refuses the turn);
    // a failed fetch keeps its cause, which says whether it is transient.
    if (err instanceof ArchiveMismatchError) throw new PluginMountError(slug, "the fetched archive does not match the installed version's digest");
    throw new PluginMountError(slug, `its archive could not be fetched (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
  if (archive === undefined) {
    throw new PluginMountError(slug, "the server holds no archive for it");
  }
  const entries = await extractZipFileEntries(archive);
  if (entries.length === 0) {
    throw new PluginMountError(slug, "its archive holds no files");
  }
  const mountable = withoutEvalSuite(entries, plugin.status?.evals?.dir, manifestEvalDir(entries));
  await keepArchive(platformDir, digest, archive, mountable.length === entries.length);

  const tree = await placeArchiveTree({
    linkPath: join(platformDir, PLUGINS_SUBDIR, digest),
    sessionId,
    key: pluginTreeKey(digest),
    entries: mountable,
    label: ARCHIVE_LABEL,
  });

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
export function cleanEntryPath(name: string): string {
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
