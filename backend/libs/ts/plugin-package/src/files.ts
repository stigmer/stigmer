/**
 * The reader the library is pure over, and the path discipline every path in
 * a package obeys.
 *
 * `PluginFiles` is a sorted list of SIZED entries plus `read`. The size is
 * declared up front so the library can refuse an over-cap document before a
 * byte is read: an archive reader may hold a deflated entry whose declared
 * size is the only defence against inflating a bomb, and a cap checked after
 * `read` would be no defence at all. The reader's contract is that `read`
 * never returns more than `size` bytes (a directory reader uses the file's
 * stat size; an archive reader passes the central directory's declared size
 * as its inflate limit). The library checks both sides anyway: the declared
 * size before reading, the returned length after, refusing either as
 * `document-too-large`. Nothing here touches the filesystem or any `node:*`
 * module; the CLI's directory walker and the server's archive reader each
 * implement this interface at their edge.
 *
 * Containment is lexical here and physical in each reader. A listed path
 * that is absolute, contains `..` or a backslash, or has an empty segment is
 * refused by the library; a reader never follows a symlink, and an archive
 * has none. A path DECLARED in a manifest must begin with `./` (or be `.`),
 * the open format's rule for every plugin-relative path.
 */

import type { PluginErrorKind } from "./outcome.js";

export interface PluginFileEntry {
  /** Plugin-relative POSIX path, no leading `./`, files only. */
  readonly path: string;
  /** The entry's declared size in bytes; `read` returns at most this many. */
  readonly size: number;
}

export interface PluginFiles {
  /** Sorted by path (code-point order), files only, every path contained. */
  readonly entries: readonly PluginFileEntry[];
  /** The bytes of one listed path. */
  read(path: string): Uint8Array;
}

/**
 * Per-document byte caps, checked from declared sizes. A plugin's documents
 * are small by nature; the caps exist so no reader can be made to inflate
 * a large entry through the library, not to bound legitimate content.
 */
export const PLUGIN_DOCUMENT_LIMITS = {
  /** A manifest (`plugin.json` in any dialect). Real manifests are a few KB. */
  manifest: 256 * 1024,
  /** An MCP configuration file. */
  mcpConfig: 256 * 1024,
  /**
   * A `SKILL.md`. The server's skill push gate inflates a `SKILL.md` alone
   * under the same 1 MB cap, so a skill this library accepts is one the push
   * gate accepts.
   */
  skillMd: 1024 * 1024,
  /** A sub-agent file (`agents/*.md`): a prompt, so the `SKILL.md` cap. */
  subAgent: 1024 * 1024,
  /** A document under `ai.stigmer/`: a resource YAML. */
  overlay: 1024 * 1024,
  /**
   * A plugin's logo, the image a storefront card shows. Checked from the
   * listing's declared size before a client hands the file's URL to an
   * `<img>`; measured across the three vendors' catalogues on 2026-09-18,
   * the largest published logo is 361 KB and the median 7.5 KB.
   */
  logo: 1024 * 1024,
  /**
   * A marketplace file in any dialect. The largest public catalogue
   * (`cursor/plugins`, 79 entries with descriptions) is under 32 KB; the cap
   * leaves room for catalogues an order of magnitude larger.
   */
  marketplace: 1024 * 1024,
} as const;

export type PluginDocumentClass = keyof typeof PLUGIN_DOCUMENT_LIMITS;

const encoder = new TextEncoder();
// `fatal: false` keeps the decoder from throwing on a malformed sequence: a
// document with bad UTF-8 reaches the JSON or YAML parser, which refuses it
// with its own sentence, rather than crashing the read.
const decoder = new TextDecoder("utf-8", { fatal: false });

/** An in-memory `PluginFiles` over path -> content; the testing builders' product. */
export function inMemoryPluginFiles(files: ReadonlyMap<string, Uint8Array | string>): PluginFiles {
  const bytes = new Map<string, Uint8Array>();
  for (const [path, content] of files) {
    bytes.set(path, typeof content === "string" ? encoder.encode(content) : content);
  }
  const entries = [...bytes.entries()]
    .map(([path, content]) => ({ path, size: content.length }))
    .sort((a, b) => comparePaths(a.path, b.path));
  return {
    entries,
    read(path) {
      const content = bytes.get(path);
      if (content === undefined) {
        throw new Error(`plugin file '${path}' is not listed`);
      }
      return content;
    },
  };
}

/** Code-point order, the order `entries` is sorted in. */
export function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** UTF-8 text with a leading byte-order mark removed (a manifest saved with a BOM was a known load failure elsewhere). */
export function decodeUtf8(bytes: Uint8Array): string {
  const text = decoder.decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Lexical containment of a LISTED path: relative, forward slashes only, no
 * `.` or `..` segments, no empty segments. Readers produce such paths; the
 * library refuses a reader that did not.
 */
export function isContainedPath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export type DeclaredPathOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly kind: Extract<PluginErrorKind, "path-not-relative" | "path-escapes-root" | "path-glob-unsupported"> };

const GLOB_CHARACTERS = /[*?[\]{}]/;

/**
 * Normalise a path DECLARED in a manifest (`"./skills/"`, `"."`,
 * `"./agents/reviewer.md"`) to a plugin-relative path with no leading `./`
 * and no trailing slash; the plugin root itself is the empty string. The
 * open format requires the `./` prefix; the vendor dialects document the
 * same rule; a glob is refused because no plugin in the wild uses one and
 * expanding globs is a second path language the library would then have
 * to own.
 */
export function resolveDeclaredPath(value: string): DeclaredPathOutcome {
  if (GLOB_CHARACTERS.test(value)) return { ok: false, kind: "path-glob-unsupported" };
  if (value === "." || value === "./") return { ok: true, path: "" };
  if (!value.startsWith("./")) return { ok: false, kind: "path-not-relative" };
  const trimmed = value.slice(2).replace(/\/+$/, "");
  if (trimmed === "") return { ok: true, path: "" };
  if (!isContainedPath(trimmed)) return { ok: false, kind: "path-escapes-root" };
  return { ok: true, path: trimmed };
}

/** `dir + "/" + name`, or `name` at the plugin root. */
export function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

/** The last segment of a plugin-relative path. */
export function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/** The path without its last segment; the empty string at the root. */
export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Indexed access over a `PluginFiles`: membership, the files under a
 * directory, a directory's immediate children. Built once per read; every
 * lookup is a map or a prefix walk over the sorted entries.
 */
export class PluginFileIndex {
  private readonly byPath: ReadonlyMap<string, PluginFileEntry>;

  constructor(readonly files: PluginFiles) {
    this.byPath = new Map(files.entries.map((entry) => [entry.path, entry]));
  }

  has(path: string): boolean {
    return this.byPath.has(path);
  }

  entry(path: string): PluginFileEntry | undefined {
    return this.byPath.get(path);
  }

  /** Every file under `dir` (recursively), in entry order; every file at the root when `dir` is empty. */
  filesUnder(dir: string): readonly string[] {
    if (dir === "") return this.files.entries.map((entry) => entry.path);
    const prefix = `${dir}/`;
    return this.files.entries.filter((entry) => entry.path.startsWith(prefix)).map((entry) => entry.path);
  }

  /** True when at least one file lives under `dir`. */
  isDirectory(dir: string): boolean {
    if (dir === "") return this.files.entries.length > 0;
    const prefix = `${dir}/`;
    return this.files.entries.some((entry) => entry.path.startsWith(prefix));
  }

  /** The immediate child directory names under `dir`, sorted, deduplicated. */
  childDirectories(dir: string): readonly string[] {
    const prefix = dir === "" ? "" : `${dir}/`;
    const names = new Set<string>();
    for (const entry of this.files.entries) {
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash !== -1) names.add(rest.slice(0, slash));
    }
    return [...names].sort(comparePaths);
  }

  /** The immediate child FILE names under `dir`, sorted. */
  childFiles(dir: string): readonly string[] {
    const prefix = dir === "" ? "" : `${dir}/`;
    const names: string[] = [];
    for (const entry of this.files.entries) {
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      if (!rest.includes("/")) names.push(rest);
    }
    return names.sort(comparePaths);
  }
}
