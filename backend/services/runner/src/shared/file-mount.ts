/**
 * The File mount: the conversation's Files, placed under the session's
 * platform `uploads/` folder once per turn, where the agent finds each at
 * `.stigmer/uploads/<mount_path>` through the workspace `.stigmer` link.
 *
 * The server names everything: `RunFileController.mount` answers the
 * Files the run's conversation holds (`SessionSpec.resources`), each with
 * its mount path, its size and a short-lived link to its bytes signed for
 * this runner. The runner asks once per turn, under the run's credential,
 * as it fetches the run's values ({@link fetchRunFileMounts}), and makes
 * `uploads/` hold exactly those Files ({@link mountFiles}):
 *
 *  - Kept: a File whose record in the index names the same File id at the
 *    same mount path, and whose file on disk still has the size and the
 *    modification time the record noted when it was written. A File's bytes
 *    never change, so a kept File is not fetched again; the size and time
 *    catch a copy the agent edited or replaced, which is fetched again.
 *  - Removed: everything else under `uploads/` — a File the conversation
 *    dropped, a File now at another path, anything the agent wrote there,
 *    a link, an emptied folder. `uploads/` is the mount's alone.
 *  - Fetched: each File not kept, streamed to disk in pieces of at most
 *    {@link FLUSH_BYTES} (a File may be hundreds of megabytes; nothing holds
 *    it whole) and checked against its recorded size. A failure removes the
 *    partial file and ends the turn with a {@link FileMountError}: a File
 *    is an explicit input, and a turn that silently ran without one would
 *    answer wrongly.
 *
 * The index is one JSON file beside `uploads/` in the platform folder
 * ({@link UPLOADS_INDEX_FILE}), never inside it, so the agent never lists
 * it as a File. It is written after every File landed, so a turn that
 * stops part-way leaves records only for what was already there; a File
 * written part-way has no record whose time matches, and is fetched again.
 *
 * Every operation goes through `agent-fs.ts`, so in the runner the agent
 * host performs it with the agent's rights. The links stay in the runner:
 * the bytes cross to the host, the URL never does, and no error carries
 * its query, where the signature is.
 *
 * The workspace `.stigmer` link is ensured whenever a File is mounted, so
 * a turn whose only platform content is a File still reaches it. The eval
 * reference folders under `inputs/` are another writer's
 * (`eval-case/prepare-case.ts`) and are never touched here.
 */

import { dirname, join, posix, relative, sep } from "node:path";
import type { FileMount } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import type { ContentBlock } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";

import type { StigmerClient } from "../client/stigmer-client.js";
import { agentFs, type AgentStats } from "./agent-fs.js";
import { entryPathIn } from "./archive-mount.js";
import type { VisionBudget, VisionOutcome } from "./attachment-vision.js";
import { getPlatformDir } from "./workspace/platform-dir.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "./workspace/stigmer-link.js";

/** The platform folder the conversation's Files are mounted under. */
export const UPLOADS_SUBDIR = "uploads";

/** The mount's record of what it wrote, beside `uploads/` in the platform folder. */
export const UPLOADS_INDEX_FILE = "uploads.index.json";

/** The most bytes of a File held before they are written: the mount's memory bound per File. */
export const FLUSH_BYTES = 8 * 1024 * 1024;

/** A file a prompt lists: its name, where the agent reads it, its size. */
export interface ListedFile {
  readonly filename: string;
  /** Workspace-relative: `.stigmer/uploads/<mount_path>`, or `.stigmer/inputs/…` for an eval reference. */
  readonly relativePath: string;
  readonly sizeBytes: number;
}

/** A File as the mount placed it. */
export interface MountedFile extends ListedFile {
  readonly fileId: string;
  /** Relative to `uploads/`. */
  readonly mountPath: string;
  readonly mimeType: string;
}

/** A File this turn's message carried: an image the model may see, or a document it reads with its tools. */
export interface MessageFile extends MountedFile {
  readonly kind: "image" | "document";
}

/** A File that could not be mounted; the turn ends with it. */
export class FileMountError extends Error {
  constructor(subject: string, reason: string) {
    super(`File '${subject}': ${reason}`);
    this.name = "FileMountError";
  }
}

/** What {@link mountFiles} needs besides the entries. */
export interface FileMountOptions {
  readonly sessionId: string;
  readonly primaryWorkspaceDir: string;
}

/** One record of the index: what was written at a mount path, and what the file looked like then. */
interface IndexRecord {
  readonly fileId: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
}

/**
 * The Files a run's conversation holds, as the server answers them, asked
 * under the run's scoped credential (the value fetch's authority,
 * `run-values.ts` `fetchTurnValues`).
 */
export async function fetchRunFileMounts(client: StigmerClient, executionId: string): Promise<FileMount[]> {
  const scopedToken = await client.acquireScopedRunnerToken({ agentExecutionId: executionId });
  return client.mountRunFiles(executionId, scopedToken);
}

/**
 * Make the session's `uploads/` hold exactly `entries` (see the module
 * header) and return them as mounted, in the server's order. Throws
 * {@link FileMountError} on the first File that cannot be placed.
 */
export async function mountFiles(entries: readonly FileMount[], options: FileMountOptions): Promise<MountedFile[]> {
  const platformDir = getPlatformDir(options.sessionId);
  const uploadsDir = join(platformDir, UPLOADS_SUBDIR);
  const wanted = new Map<string, FileMount>();
  for (const entry of entries) {
    const path = mountPathOf(entry);
    if (wanted.has(path)) throw new FileMountError(path, "two of the conversation's Files name this mount path");
    wanted.set(path, entry);
  }

  const index = await readIndex(platformDir);
  const kept = await pruneUploads(uploadsDir, wanted, index);
  if (wanted.size > 0) await ensureStigmerSymlink(options.primaryWorkspaceDir, platformDir);

  const records = new Map<string, IndexRecord>();
  let fetched = 0;
  for (const [path, entry] of wanted) {
    const record = kept.get(path);
    if (record !== undefined) {
      records.set(path, record);
      continue;
    }
    records.set(path, await download(entry, path, uploadsDir));
    fetched += 1;
  }
  await writeIndex(platformDir, records);
  if (wanted.size > 0) {
    console.log(`[file-mount] session=${options.sessionId} files=${wanted.size} fetched=${fetched} kept=${wanted.size - fetched}`);
  }

  return [...wanted].map(([path, entry]) => ({
    fileId: entry.fileId,
    mountPath: path,
    filename: entry.filename || posix.basename(path),
    mimeType: entry.mimeType,
    sizeBytes: Number(entry.sizeBytes),
    relativePath: posix.join(STIGMER_LOCAL_STATE_DIR, UPLOADS_SUBDIR, path),
  }));
}

/**
 * This turn's message files (`RunStatus.message_files`) among the mounted
 * Files, in the message's order, and the conversation's other Files in
 * the mount's. Each block names its File by id; a block whose File the
 * mount did not answer ends the turn, as a File that cannot be fetched does.
 */
export function splitMessageFiles(
  blocks: readonly ContentBlock[],
  mounted: readonly MountedFile[],
): { readonly message: readonly MessageFile[]; readonly conversation: readonly MountedFile[] } {
  const byId = new Map(mounted.map((file) => [file.fileId, file] as const));
  const message: MessageFile[] = [];
  for (const block of blocks) {
    if (block.source?.type !== "file") continue;
    const fileId = block.source.fileId;
    if (message.some((file) => file.fileId === fileId)) continue;
    const file = byId.get(fileId);
    if (file === undefined) {
      throw new FileMountError(fileId, "this message carried it, but the conversation does not hold it");
    }
    message.push({ ...file, kind: block.type === "image" ? "image" : "document" });
  }
  const inMessage = new Set(message.map((file) => file.fileId));
  return { message, conversation: mounted.filter((file) => !inMessage.has(file.fileId)) };
}

/**
 * Offer a mounted image to the turn's vision budget (`attachment-vision.ts`
 * owns every rule). The bytes are read from disk only when they could be
 * accepted: a model that cannot see, or an image over the per-image cap,
 * settles the outcome without the read. The image is labelled with its
 * mount path, where the agent finds it, never the File's own filename: a
 * second `image.png` sits at `image-2.png`.
 */
export async function offerMountedImage(
  file: MountedFile,
  sessionId: string,
  budget: VisionBudget,
): Promise<VisionOutcome> {
  if (budget.modelCannotSee()) return budget.offerBlind();
  if (budget.exceedsImageCap(file.sizeBytes)) return budget.offerOversized();
  const bytes = await agentFs().readFile(join(getPlatformDir(sessionId), UPLOADS_SUBDIR, file.mountPath));
  return budget.offer(file.mountPath, file.mimeType, bytes);
}

/** The entry's mount path, refused when empty or when it would leave `uploads/`. */
function mountPathOf(entry: FileMount): string {
  const path = posix.normalize(entry.mountPath);
  if (entry.mountPath === "" || path === "." || path === ".." || path.startsWith("../") || posix.isAbsolute(path)) {
    throw new FileMountError(entry.fileId, `mount path '${entry.mountPath}' is not a place inside uploads/`);
  }
  return path.replace(/\/+$/, "");
}

/**
 * Remove everything under `uploads/` that is not a kept File, and answer
 * the kept Files' records. `uploads/` itself, when it is anything but a
 * directory (a link the agent planted), is removed whole.
 */
async function pruneUploads(
  uploadsDir: string,
  wanted: ReadonlyMap<string, FileMount>,
  index: ReadonlyMap<string, IndexRecord>,
): Promise<Map<string, IndexRecord>> {
  const kept = new Map<string, IndexRecord>();
  const root = await lstatOrUndefined(uploadsDir);
  if (root === undefined) return kept;
  if (!root.isDirectory()) {
    await agentFs().rm(uploadsDir, { force: true });
    return kept;
  }

  const entries = await agentFs().readdir(uploadsDir, { recursive: true });
  const directories: string[] = [];
  const doomed: string[] = [];
  for (const entry of entries) {
    const path = relative(uploadsDir, join(entry.parentPath, entry.name)).split(sep).join("/");
    if (entry.isDirectory()) {
      directories.push(path);
      continue;
    }
    const record = entry.isFile() ? await keptRecord(join(uploadsDir, path), wanted.get(path), index.get(path)) : undefined;
    if (record === undefined) doomed.push(path);
    else kept.set(path, record);
  }

  const holding = new Set<string>();
  for (const path of kept.keys()) {
    for (let dir = posix.dirname(path); dir !== "."; dir = posix.dirname(dir)) holding.add(dir);
  }
  for (const path of [...doomed, ...directories.filter((dir) => !holding.has(dir))]) {
    await agentFs().rm(join(uploadsDir, path), { recursive: true, force: true });
  }
  return kept;
}

/** The record a file on disk is kept under, or `undefined` when it must go (see the module header, Kept). */
async function keptRecord(
  path: string,
  entry: FileMount | undefined,
  record: IndexRecord | undefined,
): Promise<IndexRecord | undefined> {
  if (entry === undefined || record === undefined || record.fileId !== entry.fileId) return undefined;
  const stats = await agentFs().lstat(path);
  const unchanged = stats.size === record.sizeBytes && stats.mtimeMs === record.mtimeMs && stats.size === Number(entry.sizeBytes);
  return unchanged ? record : undefined;
}

/**
 * Make one File's folder, stream its bytes to its place, check the size, and
 * answer its record. Any failure, the folder's included (a parent that is a
 * file), is a {@link FileMountError}, and the partial file is removed.
 */
async function download(
  entry: FileMount,
  path: string,
  uploadsDir: string,
): Promise<IndexRecord> {
  const dest = entryPathIn(uploadsDir, path, "File mount");
  const expected = Number(entry.sizeBytes);
  let foldered = false;
  try {
    await agentFs().mkdir(dirname(dest), { recursive: true });
    foldered = true;
    const response = await fetch(entry.url);
    if (!response.ok || response.body === null) {
      throw new Error(`HTTP ${response.status} from ${withoutQuery(entry.url)}`);
    }
    const written = await streamToFile(response.body, dest, expected);
    if (written !== expected) {
      throw new Error(`got ${written} bytes, expected ${expected}`);
    }
  } catch (err) {
    // Best effort: when the folder could not be made, the path cannot be
    // removed either (ENOTDIR), and the mount's error is the one to report.
    await agentFs().rm(dest, { force: true }).catch(() => undefined);
    if (!foldered) throw new FileMountError(path, `its folder could not be made: ${errorText(err)}`);
    // A refused connection says only "fetch failed": name the origin the
    // link points at, never its path (the blob's key) or its query.
    const text = scrubbed(errorText(err), entry.url);
    const origin = originOf(entry.url);
    const where = origin !== "" && !text.includes(origin) ? ` (from ${origin})` : "";
    throw new FileMountError(path, `could not be fetched: ${text}${where}`);
  }
  const stats = await agentFs().lstat(dest);
  return { fileId: entry.fileId, sizeBytes: stats.size, mtimeMs: stats.mtimeMs };
}

/**
 * Write a body to `dest` in pieces of at most {@link FLUSH_BYTES}, and
 * answer how many bytes arrived. A body that runs past `expected` is cut
 * off there: the size check fails it without reading the rest.
 */
async function streamToFile(body: ReadableStream<Uint8Array>, dest: string, expected: number): Promise<number> {
  await agentFs().writeFile(dest, new Uint8Array());
  const reader = body.getReader();
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let written = 0;
  const flush = async (): Promise<void> => {
    if (pendingBytes === 0) return;
    await agentFs().appendFile(dest, Buffer.concat(pending));
    pending = [];
    pendingBytes = 0;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    written += value.length;
    if (written > expected) {
      await reader.cancel();
      return written;
    }
    pending.push(value);
    pendingBytes += value.length;
    if (pendingBytes >= FLUSH_BYTES) await flush();
  }
  await flush();
  return written;
}

/**
 * The index as the last mount wrote it; empty when there is none or it
 * cannot be read. The records are keyed by mount path, which the server
 * chooses from a user's filename, so they live in a `Map`: a path such as
 * `__proto__` is an ordinary key there, never an object's prototype.
 */
async function readIndex(platformDir: string): Promise<Map<string, IndexRecord>> {
  let raw: string;
  try {
    raw = (await agentFs().readFile(join(platformDir, UPLOADS_INDEX_FILE))).toString("utf8");
  } catch {
    return new Map();
  }
  try {
    // `JSON.parse` makes a `__proto__` key an own property, which
    // `Object.entries` reads like any other.
    const parsed = JSON.parse(raw) as { readonly files?: Record<string, IndexRecord> };
    return new Map(Object.entries(parsed.files ?? {}));
  } catch (err) {
    console.warn(`[file-mount] the uploads index could not be read; every File is fetched again: ${errorText(err)}`);
    return new Map();
  }
}

/**
 * Replace the index whole: written beside, then renamed over, so a reader
 * never sees half of it. On disk it stays `{ "files": { <mount path>: record } }`;
 * `Object.fromEntries` defines each key as an own property, so `__proto__`
 * is written as a key like any other.
 */
async function writeIndex(platformDir: string, files: ReadonlyMap<string, IndexRecord>): Promise<void> {
  const path = join(platformDir, UPLOADS_INDEX_FILE);
  await agentFs().mkdir(platformDir, { recursive: true });
  await agentFs().writeFile(`${path}.next`, JSON.stringify({ files: Object.fromEntries(files) }));
  await agentFs().rename(`${path}.next`, path);
}

async function lstatOrUndefined(path: string): Promise<AgentStats | undefined> {
  try {
    return await agentFs().lstat(path);
  } catch {
    return undefined;
  }
}

/**
 * A link without its query: the signature is in the query string, and an
 * error that carries it may reach a run's status (`archive-mount.ts` keeps
 * the same rule for an archive's link).
 */
/** A link's scheme, host and port; empty when it does not parse or names no host. */
function originOf(url: string): string {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? "" : origin;
  } catch {
    return "";
  }
}

export function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "the File's link";
  }
}

/** `text` with the link, and its query, replaced wherever they appear. */
export function scrubbed(text: string, url: string): string {
  let out = url === "" ? text : text.split(url).join(withoutQuery(url));
  const query = queryOf(url);
  if (query !== "") out = out.split(query).join("");
  return out;
}

function queryOf(url: string): string {
  try {
    return new URL(url).search;
  } catch {
    return "";
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
