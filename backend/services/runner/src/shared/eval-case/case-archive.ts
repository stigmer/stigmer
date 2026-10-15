/**
 * An eval case's files, read from its source's archive at the version the
 * eval run stamped and held in memory for the turn.
 *
 * The server planned the case from the same archive (`RunSpec.
 * eval_case`): a plugin's (its id, its digest) or an Eval's (its id, its
 * digest), and the source-relative paths of what the try needs. The runner
 * fetches the archive the way a mount does (`archive-mount.ts`), refuses
 * any bytes that do not hash to the stamped digest, and keeps every entry
 * in memory by its cleaned name (`plugin-mount.ts` `cleanEntryPath`, the
 * name the server's reader gives it). Nothing of the suite is written to
 * disk here: the scaffold's brief copy and the reference folders the agent
 * may read are the callers' own writes, each said where it happens.
 *
 * A plugin's archive is read by its storage key, as a mount reads it. An
 * Eval's is read by its reference at the stamped version, the read that
 * asks can_view of the run's caller first, since an Eval may hold copies
 * of conversations: a caller who may no longer view it gets no byte, and
 * the try fails naming the Eval.
 *
 * A plugin that moved past the eval's version is refused: the case workflow
 * starts no try then, so meeting it here means a push landed between the
 * workflow's check and the turn, and the try must not run another version's
 * case. An Eval never moves: every version stays readable by its digest.
 */

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { EvalCaseContext } from "@stigmer/protos/ai/stigmer/agentic/run/v1/eval_case_pb";
import type { StigmerClient } from "../../client/stigmer-client.js";
import { downloadArchive } from "../archive-mount.js";
import { cleanEntryPath, sha256Hex } from "../plugin-mount.js";
import { extractZipFileEntries } from "../zip-extract.js";

/** A case's archive, read once for the turn. */
export interface CaseArchive {
  /** The bytes of one source-relative path, or `undefined` when the archive has no such file. */
  read(path: string): Uint8Array | undefined;
  /** The same file as UTF-8 text. */
  text(path: string): string | undefined;
  /** Every file under a source-relative directory (`""` is the root), as `[path relative to dir, bytes]`, sorted by path. */
  under(dir: string): readonly (readonly [string, Uint8Array])[];
}

/** The archive cannot serve the case; its message names why, for the run's error. */
export class CaseArchiveError extends Error {
  constructor(detail: string, options?: { readonly cause?: unknown }) {
    super(`the eval run's case could not be read: ${detail}`, options);
    this.name = "CaseArchiveError";
  }
}

/** Fetch, verify and index the archive the case names. Throws {@link CaseArchiveError}. */
export async function fetchCaseArchive(client: StigmerClient, context: EvalCaseContext): Promise<CaseArchive> {
  return context.evalId !== "" ? fetchEvalArchive(client, context) : fetchPluginArchive(client, context);
}

/** An Eval's archive at its stamped digest, through the read that asks can_view. */
async function fetchEvalArchive(client: StigmerClient, context: EvalCaseContext): Promise<CaseArchive> {
  const ref = create(ApiResourceReferenceSchema, { kind: ApiResourceKind.eval, id: context.evalId, version: context.evalDigest });
  let bytes: Uint8Array | undefined;
  try {
    bytes = await downloadArchive(
      {
        mintDownloadUrl: () => client.getEvalDownloadUrl(ref),
        fetchUnary: () => client.downloadEval(ref),
        inlineOn: [Code.Unimplemented, Code.FailedPrecondition],
      },
      context.evalId,
    );
  } catch (err) {
    throw new CaseArchiveError(`eval ${context.evalId} could not be read (${err instanceof Error ? err.message : String(err)})`, {
      cause: err,
    });
  }
  if (bytes === undefined) throw new CaseArchiveError(`the server holds no archive for eval ${context.evalId}`);
  if (sha256Hex(bytes) !== context.evalDigest) throw new CaseArchiveError("the fetched archive does not match the eval's version");
  return caseArchiveOf(await extractZipFileEntries(bytes));
}

/** A plugin's archive at the eval's digest, by its storage key, as a mount reads it. */
async function fetchPluginArchive(client: StigmerClient, context: EvalCaseContext): Promise<CaseArchive> {
  const plugin = await client.getPlugin(context.pluginId).catch((err: unknown) => {
    throw new CaseArchiveError(`the plugin could not be read (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  });
  const digest = plugin.status?.digest ?? "";
  if (digest !== context.pluginDigest) {
    throw new CaseArchiveError("the plugin has moved past the eval's version");
  }
  const storageKey = plugin.status?.artifactStorageKey ?? "";
  if (storageKey === "") throw new CaseArchiveError("the plugin records no archive");
  let bytes: Uint8Array | undefined;
  try {
    bytes = await downloadArchive(
      {
        mintDownloadUrl: (key) => client.getPluginArtifactDownloadUrl(key),
        fetchUnary: (key) => client.getPluginArtifact(key),
      },
      storageKey,
    );
  } catch (err) {
    throw new CaseArchiveError(`the archive could not be fetched (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
  if (bytes === undefined) throw new CaseArchiveError("the server holds no archive for the plugin");
  if (sha256Hex(bytes) !== context.pluginDigest) throw new CaseArchiveError("the fetched archive does not match the eval's version");
  return caseArchiveOf(await extractZipFileEntries(bytes));
}

/** An archive index over already-extracted entries; exported for tests. */
export function caseArchiveOf(entries: readonly { readonly path: string; readonly content: Uint8Array }[]): CaseArchive {
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) files.set(cleanEntryPath(entry.path), entry.content);
  const decoder = new TextDecoder();
  return {
    read: (path) => files.get(path),
    text: (path) => {
      const bytes = files.get(path);
      return bytes === undefined ? undefined : decoder.decode(bytes);
    },
    under: (dir) => {
      const prefix = dir === "" ? "" : `${dir}/`;
      return [...files]
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, bytes]) => [path.slice(prefix.length), bytes] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    },
  };
}

/** `dir/path`, or `path` at the archive's root (an Eval's suite is its root, `suite_dir` empty). */
export function joinCasePath(dir: string, path: string): string {
  return dir === "" ? path : `${dir}/${path}`;
}
