// Which files on the person's disk a model may hand a run (run_agent's
// `files`), and how they reach it.
//
// A person typing `stigmer run <agent> --attach <path>` chooses their own
// file. A model naming a path does not, so the tool bounds what it reads by
// two conditions, both required:
//   - the server shares the person's disk: only the CLI's own `stigmer
//     mcp-server` over stdio runs as a child of the person's coding agent, on
//     their machine (BackendTarget.localFiles). The hosted server, and every
//     HTTP roster wherever it runs, never set it, so a path there means
//     nothing and is refused.
//   - the path is inside a folder the client names as a workspace (the MCP
//     roots the client lists): the folders the person opened, never the
//     server process's working directory, which a client may set anywhere
//     (the home folder, `/`). The path's real path is checked, symlinks
//     followed, so a link out of the project is refused like the target it
//     names. A client that names no roots is refused, pointing to the CLI.
//
// A relative path is read against each root in the order the client lists
// them, the first that holds it winning: the model speaks in the person's
// project's terms ("samples/march.csv"). Only regular files are taken; a
// folder belongs to the conversation, which the CLI's `--attach` gives
// (`client-apps/cli/src/resources/run/files.ts`), and at most 20 files ride
// one message (RunSpec.file_ids), the CLI's own limit.
//
// The upload is the SDK's (`uploadFileFromPath` over a RoutedFileClient on
// the call's transport), so a large file streams from disk and is staged by
// reference exactly as the CLI's are. A failed batch deletes what it
// uploaded before the failure surfaces.

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Transport } from "@connectrpc/connect";
import { RoutedFileClient } from "@stigmer/client";
import { uploadFileFromPath } from "@stigmer/client/node";

/** The most Files one message carries (RunSpec.file_ids); the CLI's limit too. */
export const MAX_RUN_FILES = 20;

/** Where the CLI path is named in every refusal. */
const CLI_PATH = "attach it from a shell with `stigmer run <agent> --attach <path>`";

/** What the tool knows about where it runs, for the two conditions. */
export interface LocalFileAccess {
  /** The server shares the person's disk (BackendTarget.localFiles). */
  readonly localFiles: boolean;
  /**
   * The folders the client names as workspaces, as file paths; undefined
   * when the client does not offer roots at all.
   */
  readonly listRoots: () => Promise<readonly string[] | undefined>;
}

/**
 * Resolve each path a model named to a real file inside one of the client's
 * roots, or refuse the whole call naming the path and the CLI.
 */
export async function resolveLocalFiles(
  paths: readonly string[],
  access: LocalFileAccess,
): Promise<string[]> {
  if (paths.length === 0) return [];
  if (!access.localFiles) {
    throw new Error(
      "files can be handed to a run only by the Stigmer tool server running on your machine " +
        `(\`stigmer mcp-server\`); this one does not share your disk, so ${CLI_PATH}.`,
    );
  }
  if (paths.length > MAX_RUN_FILES) {
    throw new Error(`a message carries at most ${MAX_RUN_FILES} files; ${paths.length} were named.`);
  }
  const roots = await clientRoots(access);
  if (roots.length === 0) {
    throw new Error(
      "your coding agent names no workspace folders to this tool server, so no file on disk can be " +
        `handed to a run here; ${CLI_PATH}.`,
    );
  }
  return paths.map((path) => resolveOne(path, roots));
}

/** The client's roots as real paths; a root that no longer exists is skipped. */
async function clientRoots(access: LocalFileAccess): Promise<string[]> {
  const listed = await access.listRoots();
  const roots: string[] = [];
  for (const root of listed ?? []) {
    try {
      roots.push(realpathSync(root));
    } catch {
      // A root the client names that is gone from disk bounds nothing.
    }
  }
  return roots;
}

function resolveOne(path: string, roots: readonly string[]): string {
  const named = path.trim();
  if (named === "") {
    throw new Error("files: an entry is empty; name each file by its path in your project.");
  }
  const candidates = isAbsolute(named) ? [named] : roots.map((root) => resolve(root, named));
  for (const candidate of candidates) {
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      continue;
    }
    if (!roots.some((root) => isInside(root, real))) {
      throw new Error(
        `"${named}" is outside every folder your coding agent has open, so it is not handed to a run; ` +
          `if you mean it, ${CLI_PATH}.`,
      );
    }
    const stats = statSync(real);
    if (stats.isDirectory()) {
      throw new Error(
        `"${named}" is a folder; a folder is given to the conversation, not the message: ` +
          `run \`stigmer run <agent> --attach ${named}\` from a shell.`,
      );
    }
    if (!stats.isFile()) {
      throw new Error(`"${named}" is not a regular file.`);
    }
    return real;
  }
  throw new Error(`"${named}" was not found in any folder your coding agent has open.`);
}

/** Whether `path` is `root` itself or below it. */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** A `file://` root URI as a path; any other scheme names no folder on this disk. */
export function rootPath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

/**
 * Upload each file as a File, in order: into the conversation when
 * `sessionId` is set, else as the caller's own (the server copies it into
 * the new conversation when the run names it). On the first failure every
 * File already uploaded is deleted and the failure surfaces.
 */
export async function uploadLocalFiles(
  transport: Transport,
  files: readonly string[],
  target: { readonly org: string; readonly sessionId: string },
): Promise<string[]> {
  const client = new RoutedFileClient(transport);
  const ids: string[] = [];
  for (const path of files) {
    try {
      const file = await uploadFileFromPath(client, { ...target, path });
      ids.push(file.metadata?.id ?? "");
    } catch (err) {
      await deleteUploaded(transport, ids);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to upload "${path}": ${message}`);
    }
  }
  return ids;
}

/** Delete Files this call uploaded, best effort: a failure here hides no other. */
export async function deleteUploaded(transport: Transport, ids: readonly string[]): Promise<void> {
  const client = new RoutedFileClient(transport);
  await Promise.allSettled(ids.filter((id) => id !== "").map((id) => client.delete(id)));
}
