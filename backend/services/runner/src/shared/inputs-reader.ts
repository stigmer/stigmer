/**
 * A conversation's inputs for a turn without a computer, read from the
 * store when the agent opens one instead of copied to disk at the turn's
 * start (`file-mount.ts` is the disk copy a turn with a computer keeps).
 *
 * What a turn may read is its own inputs and nothing else, each under the
 * path its prompt names, relative to the platform folder:
 *
 *  - `uploads/<mount_path>`: the conversation's Files, as
 *    `RunFileController.mount` answers them (`entries`);
 *  - `outputs/<output_path>`: what the conversation's agent saved in its
 *    outputs folder in earlier turns, the newest File for each path, as the
 *    same call answers them (`outputs`); the outputs route reads them here
 *    and lists this turn's own writes over them (`outputs-buffer.ts`);
 *  - `inputs/<dir>/<path>`: an eval try's reference folders, from the
 *    suite archive the runner already holds for the try.
 *
 * A path under none of these is not found, whatever the store holds. The
 * server names the Files, under the run's credential, so another
 * conversation's File is never in the list; the reader adds nothing to
 * what it answered.
 *
 * A File's bytes are fetched through its signed link, in the runner (the
 * link never crosses to the agent host; the host asks for bytes by path,
 * `agent-host/remote-adapter.ts`), and checked against the size the server
 * recorded. A File over {@link MAX_INPUT_READ_BYTES} is refused with a
 * sentence rather than held in memory: a turn without a computer has no
 * disk to stream it to. A link is good for an hour; a fetch the store
 * refuses asks the server for the turn's Files again once, so a long turn
 * still reads.
 *
 * Bytes sit in one process-wide cache bounded by bytes
 * ({@link DEFAULT_INPUT_CACHE_BYTES}, `STIGMER_RUNNER_INPUT_CACHE_BYTES`),
 * keyed by the run's organization and the File's id: a File never changes,
 * and no turn is served from an entry another organization's turn filled.
 */

import type { FileMount } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import { LRUCache } from "lru-cache";
import { posix } from "node:path";

import type { VisionBudget, VisionOutcome } from "./attachment-vision.js";
import { scrubbed, UPLOADS_SUBDIR, type MountedFile } from "./file-mount.js";

/** The largest input a turn without a computer opens: as large as a skill's file (8 MiB). */
export const MAX_INPUT_READ_BYTES = 8 * 1024 * 1024;

/** The process-wide cache's default size. */
export const DEFAULT_INPUT_CACHE_BYTES = 64 * 1024 * 1024;

/** The variable that sizes the cache, in bytes. */
export const INPUT_CACHE_BYTES_ENV = "STIGMER_RUNNER_INPUT_CACHE_BYTES";

/**
 * The answers a link refused for its age, asked for again once: a bucket's
 * signed link answers 401, 403 or 410; the local artifact lane answers an
 * expired link 404.
 */
const REFETCHED_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 410]);

/** The longest one input's fetch may take. */
export const INPUT_FETCH_TIMEOUT_MS = 2 * 60 * 1000;

/** The platform folders a turn's inputs are under. */
export type InputFolder = "uploads" | "outputs" | "inputs";

/** One input, by its path under the platform folder. */
export interface InputFileInfo {
  /** `uploads/<mount_path>`, `outputs/<output_path>` or `inputs/<dir>/<path>`, forward slashes. */
  readonly path: string;
  readonly size: number;
  /** The File's id; empty for an eval reference file, which is no File. */
  readonly fileId: string;
  readonly mimeType: string;
}

/** What the engine's file tools read a turn's inputs through. */
export interface TurnInputFiles {
  /** Every input of the turn. */
  list(): Promise<readonly InputFileInfo[]>;
  /** One input's bytes; {@link InputFileNotFoundError} when the turn holds no such input, {@link InputTooLargeError} past the cap. */
  read(path: string): Promise<Uint8Array>;
}

/** A path the turn's inputs do not hold. */
export class InputFileNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`'${path}' is not one of this conversation's inputs`);
    this.name = "InputFileNotFoundError";
  }
}

/** An input over {@link MAX_INPUT_READ_BYTES}. */
export class InputTooLargeError extends Error {
  constructor(
    readonly path: string,
    readonly size: number,
  ) {
    super(
      `'${path}' is ${size} bytes; an agent without a computer opens files up to ${MAX_INPUT_READ_BYTES} bytes. ` +
        "Give the agent a computer to work with larger files",
    );
    this.name = "InputTooLargeError";
  }
}

/** The reader of a turn with no inputs. */
export const NO_TURN_INPUTS: TurnInputFiles = {
  list: async () => [],
  read: async (path) => Promise.reject(new InputFileNotFoundError(path)),
};

/** The Files the server answers for a turn: the conversation's, and its earlier outputs. */
export interface RunFileSets {
  readonly entries: readonly FileMount[];
  readonly outputs: readonly FileMount[];
}

/** A byte-bounded cache of input bytes, shared by every turn of the process. */
export type InputCache = LRUCache<string, Uint8Array>;

export function newInputCache(maxBytes: number): InputCache {
  return new LRUCache<string, Uint8Array>({ maxSize: maxBytes, sizeCalculation: (value) => Math.max(1, value.length) });
}

let processCache: InputCache | undefined;

/** The process's one cache, sized by {@link INPUT_CACHE_BYTES_ENV}. */
export function processInputCache(): InputCache {
  const configured = Number(process.env[INPUT_CACHE_BYTES_ENV]);
  processCache ??= newInputCache(Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_INPUT_CACHE_BYTES);
  return processCache;
}

/** The turn's reader, which also takes the Files of a message the person sent while the turn works. */
export interface TurnInputs extends TurnInputFiles {
  /** Replace the conversation's Files and earlier outputs with what the server answers now. */
  replace(sets: RunFileSets): void;
}

/** How the reader fetches a link; a test hands its own. */
export type InputFetch = (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>;

/**
 * The turn's reader over the server's answer `sets`, for a turn of
 * organization `org`. `references` are an eval try's reference files, by
 * their path under `inputs/`. `refetch` asks the server for the turn's
 * Files again, used once when a link is refused.
 */
export function newTurnInputs(args: {
  readonly org: string;
  readonly sets: RunFileSets;
  readonly references?: ReadonlyMap<string, Uint8Array>;
  readonly refetch: () => Promise<RunFileSets>;
  readonly cache?: InputCache;
  readonly fetch?: InputFetch;
}): TurnInputs {
  const cache = args.cache ?? processInputCache();
  const fetchLink: InputFetch = args.fetch ?? ((url, init) => fetch(url, init));
  const references = args.references ?? new Map<string, Uint8Array>();
  let byPath = filesOf(args.sets, references);

  async function fetchFile(entry: FileMount, path: string): Promise<Uint8Array> {
    let response = await fetchLink(entry.url, { signal: AbortSignal.timeout(INPUT_FETCH_TIMEOUT_MS) });
    if (REFETCHED_STATUSES.has(response.status)) {
      // The link expired under a long turn: ask the server for fresh ones once.
      const fresh = filesOf(await args.refetch(), references);
      byPath = fresh;
      const renewed = fresh.get(path);
      if (renewed?.entry === undefined || renewed.entry.fileId !== entry.fileId) throw new InputFileNotFoundError(path);
      response = await fetchLink(renewed.entry.url, { signal: AbortSignal.timeout(INPUT_FETCH_TIMEOUT_MS) });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching '${path}'`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== Number(entry.sizeBytes)) {
      throw new Error(`'${path}' arrived as ${bytes.length} bytes; the conversation records ${String(entry.sizeBytes)}`);
    }
    return bytes;
  }

  return {
    async list() {
      return [...byPath.values()].map((file) => file.info);
    },

    async read(path) {
      const file = byPath.get(path);
      if (file === undefined) throw new InputFileNotFoundError(path);
      if (file.info.size > MAX_INPUT_READ_BYTES) throw new InputTooLargeError(path, file.info.size);
      if (file.entry === undefined) return references.get(path.slice(`${INPUTS_FOLDER}/`.length)) ?? new Uint8Array();
      const key = `${args.org}:${file.entry.fileId}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      try {
        const bytes = await fetchFile(file.entry, path);
        cache.set(key, bytes);
        return bytes;
      } catch (err) {
        if (err instanceof InputFileNotFoundError) throw err;
        throw new Error(scrubbed(err instanceof Error ? err.message : String(err), file.entry.url));
      }
    },

    replace(sets) {
      byPath = filesOf(sets, references);
    },
  };
}

const INPUTS_FOLDER = "inputs";

/**
 * Offer a conversation's image to the turn's vision budget, read from the
 * store (`file-mount.ts` `offerMountedImage` is the disk twin, and its rules
 * hold: the bytes are read only when they could be accepted).
 */
export async function offerStoredImage(file: MountedFile, inputs: TurnInputFiles, budget: VisionBudget): Promise<VisionOutcome> {
  if (budget.modelCannotSee()) return budget.offerBlind();
  if (budget.exceedsImageCap(file.sizeBytes)) return budget.offerOversized();
  const bytes = await inputs.read(`${UPLOADS_SUBDIR}/${file.mountPath}`);
  return budget.offer(file.fileId, file.mountPath, file.mimeType, Buffer.from(bytes));
}

/** The bytes of the conversation's File `fileId` among the turn's inputs, or `undefined` when it holds none: the store twin of `file-mount.ts` `readMountedFile`. Never throws. */
export async function readStoredFile(inputs: TurnInputFiles, fileId: string): Promise<Buffer | undefined> {
  try {
    const file = (await inputs.list()).find((candidate) => candidate.fileId === fileId && candidate.path.startsWith(`${UPLOADS_SUBDIR}/`));
    return file === undefined ? undefined : Buffer.from(await inputs.read(file.path));
  } catch {
    return undefined;
  }
}

/** The turn's inputs by path; a later entry at one path wins, as a later mount overwrote an earlier one. */
function filesOf(
  sets: RunFileSets,
  references: ReadonlyMap<string, Uint8Array>,
): Map<string, { readonly info: InputFileInfo; readonly entry: FileMount | undefined }> {
  const files = new Map<string, { readonly info: InputFileInfo; readonly entry: FileMount | undefined }>();
  const add = (folder: InputFolder, entry: FileMount): void => {
    const inner = posix.normalize(entry.mountPath);
    if (inner === "" || inner === "." || inner.startsWith("../") || inner.startsWith("/")) return;
    const path = `${folder}/${inner}`;
    files.set(path, { info: { path, size: Number(entry.sizeBytes), fileId: entry.fileId, mimeType: entry.mimeType }, entry });
  };
  for (const entry of sets.outputs) add("outputs", entry);
  for (const entry of sets.entries) add("uploads", entry);
  for (const [inner, bytes] of references) {
    const path = `${INPUTS_FOLDER}/${inner}`;
    files.set(path, { info: { path, size: bytes.length, fileId: "", mimeType: "" }, entry: undefined });
  }
  return files;
}
