/**
 * A plugin the user hands the browser: a folder picked or dropped, or a
 * `.zip`, turned into the same preparation a marketplace entry gets.
 *
 * "Bring your Cursor, Claude Code or Codex plugin" means the folder on the
 * user's disk, so the console must take it as it is. A folder arrives as
 * `File`s with browser-relative paths (an `<input webkitdirectory>` names
 * them under the picked folder; a drop is walked by the component into
 * root-relative pairs); a zip arrives as one `File` whose entries are read
 * with fflate. Both become lazy candidates for `preparePluginFromTree`, so
 * a folder holding `node_modules/` costs its ignore file and its manifest,
 * and the digest is the one `stigmer push plugin <dir>` prints for the same
 * folder: the archive is rebuilt deterministically from the selected files,
 * never forwarded as the user zipped it.
 *
 * A zip of a folder (`zip -r plugin.zip my-plugin/`) wraps everything in
 * one directory; it is re-rooted so the manifest is found where the reader
 * looks, and the preparation records that it was. Directory entries and
 * the macOS resource fork folder are dropped before the ignore rule runs:
 * neither is a file the folder held.
 *
 * Refusals: a file that is not a zip, an empty pick, and the reader's own
 * findings as `PluginReadRefusal`. A folder whose manifest sits in a
 * dot-directory (`.cursor-plugin/`) and arrives with no dotfiles at all is
 * a browser that dropped them on the pick; the component's copy names the
 * zip as the path that always works, so the refusal here stays the
 * reader's sentence.
 */

import { unzipSync } from "fflate";
import { type LazyCandidate, preparePluginFromTree, rerootSingleDirectory } from "@stigmer/plugin-package/client";

import { MARKETPLACE_TREE_LIMITS, formatMib } from "./types.js";
import { type PreparedInstall, PluginReadRefusal } from "./read.js";

/** One file of a local pick, at the path it has inside the plugin's root. */
export interface LocalFile {
  readonly path: string;
  readonly file: File;
}

/** What the user handed over, before preparation. */
export interface LocalPick {
  readonly kind: "folder" | "zip";
  /** The folder's or the archive's name, for sentences. */
  readonly name: string;
  readonly candidates: readonly LazyCandidate[];
  /** The one directory a zip wrapped its contents in, stripped before reading; `undefined` when none. */
  readonly rerooted?: string;
}

/** A local pick this module refuses on its own account; the reader's refusals travel separately as `PluginReadRefusal`. */
export class LocalPluginError extends Error {
  constructor(
    message: string,
    readonly reason: "not-a-zip" | "empty" | "too-large",
  ) {
    super(message);
    this.name = "LocalPluginError";
  }
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;
/** macOS Finder's resource-fork sidecar folder inside archives it produced; never part of the plugin. */
const MACOS_RESOURCE_FORK = "__MACOSX/";

/**
 * The `File`s of an `<input type="file" webkitdirectory>` pick. Every path
 * begins with the picked folder's own name, which is stripped so the tree
 * is rooted where the manifest is.
 */
export function folderPickFromInput(files: ArrayLike<File>): LocalPick {
  const list = Array.from(files);
  if (list.length === 0) throw new LocalPluginError("no files were picked", "empty");
  const relative = list.map((file) => ({ path: file.webkitRelativePath || file.name, file }));
  const root = rerootSingleDirectory(relative.map((entry) => entry.path));
  const rooted = root === null ? relative : relative.map(({ path, file }) => ({ path: path.slice(root.length + 1), file }));
  return folderPick(root ?? "folder", rooted);
}

/** A folder the component walked itself (a drop), already as root-relative pairs. */
export function folderPick(name: string, files: readonly LocalFile[]): LocalPick {
  if (files.length === 0) throw new LocalPluginError(`'${name}' holds no files`, "empty");
  return {
    kind: "folder",
    name,
    candidates: files.map(({ path, file }) => ({
      path,
      size: file.size,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    })),
  };
}

/** A `.zip` the user picked, inflated and re-rooted; its bytes are all in memory once read. */
export async function zipPick(file: File): Promise<LocalPick> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!ZIP_MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new LocalPluginError(`'${file.name}' is not a zip archive`, "not-a-zip");
  }
  const entries = Object.entries(unzipSync(bytes)).filter(
    ([path]) => !path.endsWith("/") && !path.startsWith(MACOS_RESOURCE_FORK),
  );
  if (entries.length === 0) throw new LocalPluginError(`'${file.name}' holds no files`, "empty");

  const root = rerootSingleDirectory(entries.map(([path]) => path));
  const cut = root === null ? 0 : root.length + 1;
  return {
    kind: "zip",
    name: file.name,
    candidates: entries.map(([path, content]) => ({
      path: path.slice(cut),
      size: content.length,
      read: async () => content,
    })),
    ...(root !== null && { rerooted: root }),
  };
}

/**
 * Prepare the pick through the one preparation every client runs. The
 * console's archive cap applies to the selected files, so a folder whose
 * ignored contents are large is not refused for them.
 */
export async function prepareLocalPlugin(pick: LocalPick): Promise<PreparedInstall> {
  const outcome = await preparePluginFromTree(pick.candidates, {
    respectGitignore: true,
    maxBytes: MARKETPLACE_TREE_LIMITS.pluginBytes,
  });
  if (!outcome.ok) {
    switch (outcome.kind) {
      case "refused":
        throw new PluginReadRefusal(`'${pick.name}' cannot be installed`, outcome.errors, outcome.warnings);
      case "too-large":
        throw new LocalPluginError(
          `'${pick.name}' is ${formatMib(outcome.selectedBytes)} of files after ignores, over the ${formatMib(outcome.maxBytes)} a plugin archive may carry`,
          "too-large",
        );
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }
  const { plugin, warnings, stats, archive, digest } = outcome.prepared;
  return {
    origin: { kind: "upload", pick: pick.kind, name: pick.name, ...(pick.rerooted !== undefined && { rerooted: pick.rerooted }) },
    plugin,
    warnings,
    stats,
    archive,
    digest,
  };
}
