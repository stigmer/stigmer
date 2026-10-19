/**
 * The outputs folder: what an agent saves in `.stigmer/outputs/` comes back
 * to the person as Files of the conversation when the turn ends, on every
 * engine. Files it edits in the workspace are not outputs; they come back
 * through file review and write-back.
 *
 * The folder is `outputs/` in the session's platform folder, reached at
 * `.stigmer/outputs/` through the workspace link the runtime makes on every
 * turn ({@link prepareOutputsFolder}). It lives as long as the platform
 * folder does, so the next turn's agent finds what it saved before.
 *
 * Collection ({@link collectOutputs}) runs in the turn runtime once the
 * engine's turn is over, before the turn's final status write, whatever the
 * outcome: completed, cancelled, a person's stop, waiting for an approval, a
 * limit, a failure. So on every turn but a stopped one the conversation
 * lists the turn's outputs before the turn reads as idle; a stopped turn's
 * follow it, admitted by the server for a short grace after the stop.
 *
 *  - What: a walk of the folder that follows no link. Regular files only: a
 *    link, a device or a socket is skipped, and so is anything whose real
 *    path is not inside the folder. Not a security boundary (the agent can
 *    print anything it can read), but what comes back is exactly what was
 *    saved there. An empty file carries nothing and is skipped.
 *  - New or changed: the index ({@link OUTPUTS_INDEX_FILE}, beside the
 *    folder, never inside it) records each output's size, modification
 *    time, content hash and the File it became. A file whose size and time
 *    match its record is unchanged without being read; otherwise it is
 *    hashed, and a hash that matches is unchanged too. A changed or new file
 *    is returned as a new File; the earlier one stays. A file deleted from
 *    the folder loses its record and keeps its Files.
 *  - Upload: one `createOutputUploads` for the turn's changed outputs, each
 *    file streamed from disk to its link in pieces of at most
 *    {@link READ_CHUNK_BYTES} (an output may be hundreds of megabytes), then
 *    one `registerOutputs`. Every file operation goes through `agent-fs.ts`,
 *    so in the runner the agent host reads with the agent's rights; the
 *    links stay in the runner and no error carries their query.
 *  - Caps: each output at most {@link MAX_OUTPUT_BYTES}, the contract's File
 *    cap (the server may hold a lower one, and refuses that output alone);
 *    at most {@link MAX_OUTPUTS_PER_TURN} a turn. An output over a cap, or
 *    one that fails, is skipped and named in a warning, and its record is
 *    not written, so the next turn tries it again. Collection never fails a
 *    turn.
 *
 * Retries. A registration whose batch is refused is retried one output at a
 * time; an output whose upload reference was spent with no File behind it
 * is uploaded once more. The server derives each File's id from the run,
 * the path and the content hash, so a registration that already landed
 * answers the File it made.
 */

import { createHash } from "node:crypto";
import { join, posix, relative, sep } from "node:path";
import { Code, ConnectError } from "@connectrpc/connect";
import type { OutputUpload } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";

import type { StigmerClient } from "../client/stigmer-client.js";
import { agentFs, type AgentStats } from "./agent-fs.js";
import { scrubbed, withoutQuery } from "./file-mount.js";
import { getPlatformDir } from "./workspace/platform-dir.js";
import { ensureStigmerSymlink, STIGMER_LOCAL_STATE_DIR } from "./workspace/stigmer-link.js";

/** The platform folder an agent saves its outputs in, reached at `.stigmer/outputs/`. */
export const OUTPUTS_SUBDIR = "outputs";

/** The collector's record of what it returned, beside `outputs/` in the platform folder. */
export const OUTPUTS_INDEX_FILE = "outputs.index.json";

/** The most outputs one turn returns (Managed Agents' files per session). */
export const MAX_OUTPUTS_PER_TURN = 500;

/** The largest output returned: the contract's File cap (`FILE_MAX_BYTES`' default). */
export const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;

/** The most bytes of an output held at once, while hashing it or putting it to its link. */
export const READ_CHUNK_BYTES = 8 * 1024 * 1024;

/** The longest one output's upload may take before it is given up: collection must not hold a turn open. */
export const PUT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Whether a native file tool's path (virtual-rooted at the workspace,
 * `/.stigmer/outputs/…`) names something inside the outputs folder, the
 * folder itself excluded. The path is normalized first, so a `..` that
 * climbs out of the folder is not inside it.
 */
export function isInOutputsFolder(virtualPath: string): boolean {
  const normalized = posix.normalize(virtualPath.startsWith("/") ? virtualPath : `/${virtualPath}`);
  return normalized.startsWith(OUTPUTS_VIRTUAL_PREFIX) && normalized.length > OUTPUTS_VIRTUAL_PREFIX.length;
}

/** The outputs folder as the native file tools name it. */
const OUTPUTS_VIRTUAL_PREFIX = `/${STIGMER_LOCAL_STATE_DIR}/${OUTPUTS_SUBDIR}/`;

/** One record of the index: an output as it was when it last came back. */
interface IndexRecord {
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly sha256: string;
  readonly fileId: string;
}

/** A file in the folder this turn, as the walk found it. */
interface FoundOutput {
  /** Relative to the folder, "/"-separated. */
  readonly outputPath: string;
  readonly absolutePath: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
}

/** A changed output, hashed, on its way back. */
interface ChangedOutput extends FoundOutput {
  readonly sha256: string;
}

export interface CollectOutputsOptions {
  readonly client: StigmerClient;
  readonly executionId: string;
  readonly sessionId: string;
}

/** What one collection did, for the turn's log line and the tests. */
export interface CollectedOutputs {
  /** The outputs that came back as new Files this turn, by output path. */
  readonly returned: ReadonlyMap<string, string>;
  /** How many outputs were already returned and unchanged. */
  readonly unchanged: number;
  /** Each output skipped, with why. */
  readonly skipped: ReadonlyArray<{ readonly outputPath: string; readonly reason: string }>;
}

const NOTHING: CollectedOutputs = { returned: new Map(), unchanged: 0, skipped: [] };

/**
 * Make the session's outputs folder and the workspace link that reaches it:
 * the runtime's phase before skills, on every turn of a session with a
 * platform folder, so `.stigmer/outputs/` is where the prompt says it is.
 */
export async function prepareOutputsFolder(sessionId: string, primaryWorkspaceDir: string): Promise<void> {
  const platformDir = getPlatformDir(sessionId);
  const outputsDir = join(platformDir, OUTPUTS_SUBDIR);
  const found = await lstatOrUndefined(outputsDir);
  if (found !== undefined && !found.isDirectory()) {
    // A link or a file the agent put where the folder belongs.
    await agentFs().rm(outputsDir, { recursive: true, force: true });
  }
  await agentFs().mkdir(outputsDir, { recursive: true });
  await ensureStigmerSymlink(primaryWorkspaceDir, platformDir);
}

/** Return this turn's new and changed outputs as Files (the module header). Never throws. */
export async function collectOutputs(options: CollectOutputsOptions): Promise<CollectedOutputs> {
  try {
    return await collect(options);
  } catch (err) {
    console.warn(`[outputs] execution=${options.executionId} the outputs could not be collected: ${errorText(err)}`);
    return NOTHING;
  }
}

async function collect(options: CollectOutputsOptions): Promise<CollectedOutputs> {
  const platformDir = getPlatformDir(options.sessionId);
  const outputsDir = join(platformDir, OUTPUTS_SUBDIR);
  const root = await lstatOrUndefined(outputsDir);
  if (root === undefined || !root.isDirectory()) return NOTHING;

  const index = await readIndex(platformDir);
  const skipped: Array<{ outputPath: string; reason: string }> = [];
  const records = new Map<string, IndexRecord>();
  const changed: ChangedOutput[] = [];
  let unchanged = 0;

  for (const found of await walk(outputsDir, skipped)) {
    if (found.sizeBytes === 0) {
      skipped.push({ outputPath: found.outputPath, reason: "it is empty" });
      continue;
    }
    if (found.sizeBytes > MAX_OUTPUT_BYTES) {
      skipped.push({ outputPath: found.outputPath, reason: `it is ${found.sizeBytes} bytes, over the ${MAX_OUTPUT_BYTES}-byte cap` });
      continue;
    }
    const record = index.get(found.outputPath);
    if (record !== undefined && record.sizeBytes === found.sizeBytes && record.mtimeMs === found.mtimeMs) {
      records.set(found.outputPath, record);
      unchanged += 1;
      continue;
    }
    const sha256 = await hashOf(found.absolutePath, found.sizeBytes);
    if (record !== undefined && record.sha256 === sha256) {
      records.set(found.outputPath, { ...record, sizeBytes: found.sizeBytes, mtimeMs: found.mtimeMs });
      unchanged += 1;
      continue;
    }
    changed.push({ ...found, sha256 });
  }

  const returning = changed.slice(0, MAX_OUTPUTS_PER_TURN);
  for (const over of changed.slice(MAX_OUTPUTS_PER_TURN)) {
    skipped.push({ outputPath: over.outputPath, reason: `the turn already returns ${MAX_OUTPUTS_PER_TURN} outputs` });
  }

  const returned = new Map<string, string>();
  if (returning.length > 0) {
    const credential = await options.client.acquireScopedRunnerToken({ agentExecutionId: options.executionId });
    const door = new OutputDoor(options.client, options.executionId, credential);
    for (const [output, fileId] of await door.returnAll(returning, skipped)) {
      records.set(output.outputPath, {
        sizeBytes: output.sizeBytes,
        mtimeMs: output.mtimeMs,
        sha256: output.sha256,
        fileId,
      });
      returned.set(output.outputPath, fileId);
    }
  }

  await writeIndex(platformDir, records);
  for (const skip of skipped) {
    console.warn(`[outputs] execution=${options.executionId} '${skip.outputPath}' is not returned: ${skip.reason}`);
  }
  if (returned.size > 0 || unchanged > 0) {
    console.log(
      `[outputs] execution=${options.executionId} returned=${returned.size} unchanged=${unchanged} skipped=${skipped.length}`,
    );
  }
  return { returned, unchanged, skipped };
}

/**
 * Every regular file under `outputsDir`, by output path. The listing
 * follows no link; anything that is not a regular file, or whose real path
 * is not inside the folder, is named in `skipped`.
 */
async function walk(outputsDir: string, skipped: Array<{ outputPath: string; reason: string }>): Promise<FoundOutput[]> {
  const realRoot = await agentFs().realpath(outputsDir);
  const found: FoundOutput[] = [];
  for (const entry of await agentFs().readdir(outputsDir, { recursive: true })) {
    if (entry.isDirectory()) continue;
    const absolutePath = join(entry.parentPath, entry.name);
    const outputPath = relative(outputsDir, absolutePath).split(sep).join("/");
    if (!entry.isFile()) {
      skipped.push({ outputPath, reason: entry.isSymbolicLink() ? "it is a link" : "it is not a regular file" });
      continue;
    }
    const stats = await agentFs().lstat(absolutePath);
    if (!stats.isFile()) {
      skipped.push({ outputPath, reason: "it is not a regular file" });
      continue;
    }
    const real = await agentFs().realpath(absolutePath).catch(() => "");
    if (!real.startsWith(realRoot + sep)) {
      skipped.push({ outputPath, reason: "it is not inside the outputs folder" });
      continue;
    }
    found.push({ outputPath, absolutePath, sizeBytes: stats.size, mtimeMs: stats.mtimeMs });
  }
  return found.sort((a, b) => (a.outputPath < b.outputPath ? -1 : a.outputPath > b.outputPath ? 1 : 0));
}

/** The SHA-256 of a file, read in pieces. */
async function hashOf(path: string, sizeBytes: number): Promise<string> {
  const hash = createHash("sha256");
  for await (const piece of pieces(path, sizeBytes)) hash.update(piece);
  return hash.digest("hex");
}

/** A file's bytes in pieces of at most {@link READ_CHUNK_BYTES}, up to `sizeBytes`. */
async function* pieces(path: string, sizeBytes: number): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < sizeBytes; ) {
    const piece = await agentFs().readRange(path, offset, Math.min(READ_CHUNK_BYTES, sizeBytes - offset));
    if (piece.length === 0) return;
    yield piece;
    offset += piece.length;
  }
}

/** The runner's calls to the server's output door for one turn, and their retries. */
class OutputDoor {
  constructor(
    private readonly client: StigmerClient,
    private readonly executionId: string,
    private readonly credential: string | undefined,
  ) {}

  /** Each output that came back, with its File's id; every other one named in `skipped`. */
  async returnAll(
    outputs: readonly ChangedOutput[],
    skipped: Array<{ outputPath: string; reason: string }>,
  ): Promise<Array<[ChangedOutput, string]>> {
    const uploaded: Array<[ChangedOutput, string]> = [];
    for (const [output, upload] of await this.mint(outputs, skipped)) {
      try {
        await put(output, upload);
        uploaded.push([output, upload.uploadRef]);
      } catch (err) {
        skipped.push({ outputPath: output.outputPath, reason: `its upload failed: ${scrubbed(errorText(err), upload.url)}` });
      }
    }
    if (uploaded.length === 0) return [];
    try {
      const files = await this.client.registerOutputs(
        this.executionId,
        uploaded.map(([output, uploadRef]) => ({ outputPath: output.outputPath, uploadRef, contentSha256: output.sha256 })),
        this.credential,
      );
      return uploaded.map(([output], i) => [output, files[i]?.metadata?.id ?? ""]);
    } catch {
      // One output refused the batch: register each alone, so the rest come back.
      const registered: Array<[ChangedOutput, string]> = [];
      for (const [output, uploadRef] of uploaded) {
        const fileId = await this.registerOne(output, uploadRef, skipped);
        if (fileId !== undefined) registered.push([output, fileId]);
      }
      return registered;
    }
  }

  /** An upload link per output; a batch the server refuses is minted one output at a time. */
  private async mint(
    outputs: readonly ChangedOutput[],
    skipped: Array<{ outputPath: string; reason: string }>,
  ): Promise<Array<[ChangedOutput, OutputUpload]>> {
    try {
      const uploads = await this.client.createOutputUploads(this.executionId, outputs, this.credential);
      return outputs.flatMap((output, i): Array<[ChangedOutput, OutputUpload]> => {
        const upload = uploads[i];
        return upload === undefined ? [] : [[output, upload]];
      });
    } catch (err) {
      if (outputs.length === 1 || !(err instanceof ConnectError) || err.code !== Code.InvalidArgument) {
        for (const output of outputs) skipped.push({ outputPath: output.outputPath, reason: `no upload link: ${errorText(err)}` });
        return [];
      }
      const minted: Array<[ChangedOutput, OutputUpload]> = [];
      for (const output of outputs) minted.push(...(await this.mint([output], skipped)));
      return minted;
    }
  }

  /** One output's registration; a reference spent with no File is uploaded once more. */
  private async registerOne(
    output: ChangedOutput,
    uploadRef: string,
    skipped: Array<{ outputPath: string; reason: string }>,
  ): Promise<string | undefined> {
    const entry = (ref: string) => [{ outputPath: output.outputPath, uploadRef: ref, contentSha256: output.sha256 }];
    try {
      return (await this.client.registerOutputs(this.executionId, entry(uploadRef), this.credential))[0]?.metadata?.id;
    } catch (err) {
      if (!(err instanceof ConnectError) || err.code !== Code.FailedPrecondition) {
        skipped.push({ outputPath: output.outputPath, reason: `it could not be registered: ${errorText(err)}` });
        return undefined;
      }
    }
    const again: Array<{ outputPath: string; reason: string }> = [];
    const [minted] = await this.mint([output], again);
    try {
      if (minted === undefined) throw new Error(again[0]?.reason ?? "no upload link");
      await put(output, minted[1]);
      return (await this.client.registerOutputs(this.executionId, entry(minted[1].uploadRef), this.credential))[0]?.metadata?.id;
    } catch (err) {
      const text = minted === undefined ? errorText(err) : scrubbed(errorText(err), minted[1].url);
      skipped.push({ outputPath: output.outputPath, reason: `it could not be registered: ${text}` });
      return undefined;
    }
  }
}

/** Stream one output to its link; its declared size is signed into a bucket's link, so the length is sent. */
async function put(output: ChangedOutput, upload: OutputUpload): Promise<void> {
  const source = pieces(output.absolutePath, output.sizeBytes);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await source.next();
      if (next.done) controller.close();
      else controller.enqueue(new Uint8Array(next.value));
    },
    async cancel() {
      await source.return(undefined);
    },
  });
  const response = await fetch(upload.url, {
    method: "PUT",
    body,
    duplex: "half",
    signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
    headers: { "content-length": String(output.sizeBytes), "content-type": "application/octet-stream" },
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${withoutQuery(upload.url)}`);
  }
}

/**
 * The index as the last collection wrote it; empty when there is none or it
 * cannot be read. Keyed by output path, a name the agent chose, so the
 * records live in a `Map`, where `__proto__` is an ordinary key.
 */
async function readIndex(platformDir: string): Promise<Map<string, IndexRecord>> {
  let raw: string;
  try {
    raw = (await agentFs().readFile(join(platformDir, OUTPUTS_INDEX_FILE))).toString("utf8");
  } catch {
    return new Map();
  }
  try {
    const parsed = JSON.parse(raw) as { readonly outputs?: Record<string, IndexRecord> };
    return new Map(Object.entries(parsed.outputs ?? {}));
  } catch (err) {
    console.warn(`[outputs] the outputs index could not be read; every output is hashed again: ${errorText(err)}`);
    return new Map();
  }
}

/** Replace the index whole: written beside, then renamed over, so a reader never sees half of it. */
async function writeIndex(platformDir: string, outputs: ReadonlyMap<string, IndexRecord>): Promise<void> {
  const path = join(platformDir, OUTPUTS_INDEX_FILE);
  await agentFs().writeFile(`${path}.next`, JSON.stringify({ outputs: Object.fromEntries(outputs) }));
  await agentFs().rename(`${path}.next`, path);
}

async function lstatOrUndefined(path: string): Promise<AgentStats | undefined> {
  try {
    return await agentFs().lstat(path);
  } catch {
    return undefined;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
