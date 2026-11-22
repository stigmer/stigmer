/**
 * The rules every `listFiles` / `readFile` RPC serves an archive's files
 * by, whichever kind owns the archive (skills, plugins): which version may
 * be read, which files are never served, how a path is found, and how large
 * a file one reply may carry. Each kind's controller authorizes the call
 * (`can_view` on the resource id, from the RPC's annotation), loads the
 * resource and hands it here with its binding.
 *
 *  - The version is the resource's own: its head, or a row of its own
 *    history. Any other hash answers NotFound, so a hash learned elsewhere
 *    (another organization's skill with the same bytes, a version of a
 *    skill one has lost access to) opens nothing here. An empty version is
 *    the head's stored archive, which a skill keeps even when archiving its
 *    version failed and cleared its hash.
 *  - A path is matched exactly against the archive's index: no
 *    normalisation, no join, no filesystem.
 *  - The eval suite is never served: the index's suite directories
 *    (`file-index.ts`), and for a plugin the directory its status names.
 *  - A file over {@link MAX_READ_FILE_BYTES} is refused, well under the
 *    transport's 10 MiB message cap; a model pages text 500 lines at a time
 *    and never reads that much at once.
 *
 * A refusal names the resource and the path, never a storage key.
 *
 * Proven by __tests__/serve-files.test.ts and the skill and plugin
 * domains' file-read tests.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { failedPreconditionError, internalError, notFoundError } from "../pipeline/errors.js";
import { AuditNotFoundError, ResourceNotFoundError } from "../store/interface.js";
import type { Store } from "../store/interface.js";
import { ArtifactNotFoundError } from "./content-store.js";
import { inSuiteDir } from "./file-index.js";
import type { ArchiveFileEntry } from "./file-index.js";
import type { ArchiveFileReads } from "./file-reads.js";

/** The largest file one `readFile` reply carries. */
export const MAX_READ_FILE_BYTES = 8 * 1024 * 1024;

/** What a kind says about itself for its files to be served. */
export interface ServedArchiveBinding<Desc extends DescMessage> {
  readonly kind: ApiResourceKind;
  readonly schema: Desc;
  /** The noun in sentences: "skill", "plugin". */
  readonly noun: string;
  /** The head's content hash ("" for a skill whose version failed to archive). */
  headHashOf(resource: MessageShape<Desc>): string;
  /** The head's stored archive key ("" for a skill pushed without one). */
  storageKeyOf(resource: MessageShape<Desc>): string;
  /** The eval suite directory a version's status names, if any. */
  suiteDirOf(resource: MessageShape<Desc>): string | undefined;
  /** The storage key of the archive with this content hash. */
  keyForHash(hash: string): string;
  /** The resource's slug or id, for sentences. */
  nameOf(resource: MessageShape<Desc>): string;
}

/** One version of a resource whose files are served. */
export interface ServedVersion {
  /** The archive's content hash; "" when the version has no archive. */
  readonly hash: string;
  readonly storageKey: string;
  /** Directories no answer reaches beyond the index's own (a plugin's recorded suite directory). */
  readonly hiddenDirs: readonly string[];
  /** The resource, for sentences. */
  readonly named: string;
}

/** The resource by id; NotFound naming it when absent. */
export async function loadServedResource<Desc extends DescMessage>(
  store: Store,
  binding: ServedArchiveBinding<Desc>,
  id: string,
): Promise<MessageShape<Desc>> {
  try {
    return await store.getResource(binding.kind, id, binding.schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError(binding.noun, id);
    }
    throw error;
  }
}

/**
 * The version `version` names on `head`: the head itself for an empty
 * version or the head's own hash, else a row of the head's history by
 * hash. NotFound when the resource holds no such version.
 */
export async function resolveServedVersion<Desc extends DescMessage>(
  store: Store,
  binding: ServedArchiveBinding<Desc>,
  head: MessageShape<Desc>,
  headId: string,
  version: string,
): Promise<ServedVersion> {
  const named = binding.nameOf(head);
  const headHash = binding.headHashOf(head);
  if (version === "" || version === headHash) {
    // A head with no stored archive (a skill pushed without one) serves no files.
    const storageKey = binding.storageKeyOf(head);
    const hash = storageKey === "" ? "" : headHash !== "" ? headHash : (hashOfStorageKey(storageKey) ?? "");
    return { hash, storageKey: hash === "" ? "" : storageKey, hiddenDirs: suiteDirs(binding, head), named };
  }
  let snapshot: MessageShape<Desc>;
  try {
    const record = await store.getAuditRecordByHash(binding.kind, headId, version);
    snapshot = fromBinary(binding.schema, record.data);
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      throw notFoundError(`${binding.noun} version`, `${named}:${version}`);
    }
    throw internalError(error, `failed to query ${binding.noun} audit by version`);
  }
  return { hash: version, storageKey: binding.keyForHash(version), hiddenDirs: suiteDirs(binding, snapshot), named };
}

/** The files a version serves, in path order: every indexed file outside the eval suite. */
export async function listServedFiles(
  reads: ArchiveFileReads,
  noun: string,
  version: ServedVersion,
): Promise<readonly ArchiveFileEntry[]> {
  if (version.hash === "") return [];
  const index = await loadIndex(reads, noun, version);
  return index.files.filter((file) => served(file.path, index.suiteDirs, version.hiddenDirs));
}

/** One served file's bytes: found by exact path, at most {@link MAX_READ_FILE_BYTES}. */
export async function readServedFile(
  reads: ArchiveFileReads,
  noun: string,
  version: ServedVersion,
  path: string,
): Promise<Uint8Array> {
  const missing = (): Error => notFoundError(`${noun} file`, `${version.named}/${path}`);
  if (version.hash === "") throw missing();
  const index = await loadIndex(reads, noun, version);
  const file = index.files.find((candidate) => candidate.path === path);
  if (file === undefined || !served(file.path, index.suiteDirs, version.hiddenDirs)) throw missing();
  if (file.size > MAX_READ_FILE_BYTES) {
    throw failedPreconditionError(
      `'${path}' in ${noun} '${version.named}' is larger than 8 MB; an agent reads files this large with a computer`,
    );
  }
  try {
    return await reads.read(version.storageKey, file);
  } catch (error) {
    throw internalError(error, `failed to read a file of ${noun} '${version.named}'`);
  }
}

async function loadIndex(reads: ArchiveFileReads, noun: string, version: ServedVersion) {
  try {
    return await reads.index(version.hash, version.storageKey);
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) {
      throw notFoundError(`${noun} archive`, version.named);
    }
    throw internalError(error, `failed to read the files of ${noun} '${version.named}'`);
  }
}

function served(path: string, indexDirs: readonly string[], hiddenDirs: readonly string[]): boolean {
  return !inSuiteDir(path, indexDirs) && !inSuiteDir(path, hiddenDirs);
}

function suiteDirs<Desc extends DescMessage>(binding: ServedArchiveBinding<Desc>, resource: MessageShape<Desc>): readonly string[] {
  const dir = binding.suiteDirOf(resource);
  return dir === undefined || dir === "" ? [] : [dir];
}

/** The content hash a content-addressed key names (`<prefix><sha256>.zip`), or `undefined`. */
function hashOfStorageKey(storageKey: string): string | undefined {
  return /(?:^|\/)([0-9a-f]{64})\.zip$/.exec(storageKey)?.[1];
}
