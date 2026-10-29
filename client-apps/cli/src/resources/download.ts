// What `stigmer download <type> <ref>` writes, by kind. A run (the one
// pre-gate alias, as for `list` and `get`) and a session give back what
// their turns saved in the outputs folder, each File at its place in that
// folder, newest per path; a File gives back its bytes under its filename;
// an eval gives back one version of its evals/ folder. Downloads go through
// short-lived links minted per File and are partial-failure tolerant: a
// File that fails is reported and skipped, never aborting the batch. A
// File's output path is checked by the server when the runner registers it;
// it is checked again here, so a path that would land outside the chosen
// directory is refused whatever the server answered.
//
// DOWNLOAD_HANDLERS is the verb's dispatch map, beside LIST_HANDLERS and
// DELETE_HANDLERS, and the conformance test in registry/registry.test.ts
// holds it to the verb matrix's Download promises.

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/client";
import { CliExitError, ExitCode, UsageError } from "../errors/index.js";
import type { CommandResult } from "../output/index.js";
import { idPrefixOf, isSessionId, parseReference } from "./reference.js";
import { formatBytes } from "./skill.js";

export interface DownloadParams {
  /** An output path (`reports/q3.md`) or a bare filename; empty takes every output. */
  readonly outputPath: string;
  readonly outputDir: string;
}

export interface DownloadOutcome {
  readonly total: number;
  readonly downloaded: number;
  readonly noOutputs: boolean;
  /** Set when the run is not yet terminal (a soft warning, not an error). */
  readonly incompletePhase?: string;
}

/** A sink for human progress/warning lines (download is not byte-parity output). */
export type ProgressSink = (line: string) => void;

const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

export async function downloadRunOutputs(
  client: Stigmer,
  runId: string,
  params: DownloadParams,
  progress?: ProgressSink,
): Promise<DownloadOutcome> {
  const run = await client.run.get(runId);
  const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  const incompletePhase = TERMINAL_PHASES.has(phase) ? undefined : formatDownloadPhase(phase);
  if (incompletePhase !== undefined) {
    progress?.(`Run is still ${incompletePhase}. Its outputs may not be complete until the run finishes.`);
  }

  const files = await newestPerPlace(client.file.listAll({ org: run.metadata?.org ?? "", runId }));
  const outcome = await writeOutputs(client, files, params, `stigmer get run ${runId}`, progress);
  return { ...outcome, incompletePhase };
}

/**
 * `download session`: what every turn of the conversation saved in its
 * outputs folder, one File per place, the newest turn's winning; the Files
 * given to the conversation are its inputs and stay out. A conversation
 * names its own organization, so its Files are listed there.
 */
export async function downloadSessionOutputs(
  client: Stigmer,
  sessionId: string,
  params: DownloadParams,
  progress?: ProgressSink,
): Promise<DownloadOutcome> {
  const session = await client.session.get(sessionId);
  if ((session.status?.state ?? "") === "running") {
    progress?.("A turn is still running. Its outputs may not be complete until it finishes.");
  }
  const outputs = (async function* () {
    for await (const file of client.file.listAll({ org: session.metadata?.org ?? "", sessionId })) {
      if ((file.status?.runId ?? "") !== "") yield file;
    }
  })();
  const files = await newestPerPlace(outputs);
  return writeOutputs(client, files, params, `stigmer list files --session ${sessionId}`, progress);
}

/** `download file`: one File's bytes, written under its filename. */
export async function downloadFile(
  client: Stigmer,
  fileId: string,
  outputDir: string,
  progress?: ProgressSink,
): Promise<DownloadOutcome> {
  const file = await client.file.get(fileId);
  const name = file.spec?.filename ?? "";
  mkdirSync(outputDir, { recursive: true });
  try {
    const written = await downloadSingle(client, file, name, outputDir, progress);
    progress?.(`  Downloaded ${name} (${formatBytes(written)})`);
    return { total: 1, downloaded: 1, noOutputs: false };
  } catch (err) {
    progress?.(`  Failed to download ${name}: ${(err as Error).message}`);
    return { total: 1, downloaded: 0, noOutputs: false };
  }
}

// Write each output at its place under the output directory, narrowed to
// the named one when `--path` names it. `listCommand` is the command
// that shows what could have been named.
async function writeOutputs(
  client: Stigmer,
  all: readonly File[],
  params: DownloadParams,
  listCommand: string,
  progress?: ProgressSink,
): Promise<DownloadOutcome> {
  if (all.length === 0) {
    return { total: 0, downloaded: 0, noOutputs: true };
  }
  const files =
    params.outputPath === ""
      ? all
      : all.filter((f) => f.spec?.filename === params.outputPath || f.status?.outputPath === params.outputPath);
  if (files.length === 0) {
    throw new CliExitError(
      `output not found: ${params.outputPath}\n\n` + `Use '${listCommand}' to see available outputs`,
      ExitCode.General,
    );
  }

  mkdirSync(params.outputDir, { recursive: true });

  let downloaded = 0;
  for (const file of files) {
    const path = placeOf(file);
    try {
      const written = await downloadSingle(client, file, path, params.outputDir, progress);
      progress?.(`  Downloaded ${path} (${formatBytes(written)})`);
      downloaded++;
    } catch (err) {
      progress?.(`  Failed to download ${path}: ${(err as Error).message}`);
    }
  }

  return { total: files.length, downloaded, noOutputs: false };
}

/**
 * One File per place in the outputs folder: the list answers newest first,
 * so a path written twice keeps its newest File.
 */
async function newestPerPlace(listed: AsyncIterable<File>): Promise<File[]> {
  const byPlace = new Map<string, File>();
  for await (const file of listed) {
    const place = placeOf(file);
    if (!byPlace.has(place)) byPlace.set(place, file);
  }
  return [...byPlace.values()];
}

/** Where a File sits in the outputs folder; its filename when it has no path. */
function placeOf(file: File): string {
  const outputPath = file.status?.outputPath ?? "";
  return outputPath !== "" ? outputPath : (file.spec?.filename ?? "");
}

/**
 * `path` under `dir`. One check on where the path resolves refuses every
 * shape that would not land strictly inside `dir`: empty or `.` (the
 * directory itself), absolute, or climbing out through `..`.
 */
function destinationOf(dir: string, path: string): string {
  const root = resolve(dir);
  const dest = resolve(root, path);
  const rel = relative(root, dest);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`refusing a path outside the output directory: ${path}`);
  }
  return dest;
}

async function downloadSingle(
  client: Stigmer,
  file: File,
  path: string,
  outputDir: string,
  progress?: ProgressSink,
): Promise<number> {
  const destPath = destinationOf(outputDir, path);
  const url = await resolveDownloadUrl(client, file);
  mkdirSync(dirname(destPath), { recursive: true });

  progress?.(`  Downloading ${path} (${formatBytes(Number(file.status?.sizeBytes ?? 0n))})...`);

  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  let written = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      written += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  // The CLI compiles with the `dom` lib (for in-process Ink/React), so `fetch`'s
  // body types as the DOM ReadableStream. `Readable.fromWeb` wants Node's
  // stream/web variant; they are structurally identical at runtime, so we bridge
  // the two type worlds at this single boundary.
  const counted = response.body.pipeThrough(counter) as unknown as NodeReadableStream<Uint8Array>;
  await pipeline(Readable.fromWeb(counted), createWriteStream(destPath));
  return written;
}

/**
 * Mint a fresh download link for the File. There is deliberately no cached
 * link: a stored one would have expired, so the server is the single source
 * of a working URL.
 */
async function resolveDownloadUrl(client: Stigmer, file: File): Promise<string> {
  const response = await client.file.getDownloadUrl(file.metadata?.id ?? "");
  if (response.url !== "") return response.url;
  throw new Error("failed to get download URL");
}

// Human-readable non-terminal phase label (matches Go's formatPhaseForDownload).
function formatDownloadPhase(phase: RunPhase): string {
  switch (phase) {
    case RunPhase.RUN_PENDING:
      return "pending";
    case RunPhase.RUN_IN_PROGRESS:
      return "in progress";
    case RunPhase.RUN_WAITING_FOR_APPROVAL:
      return "waiting for approval";
    case RunPhase.RUN_PAUSED:
      return "paused";
    default:
      return "unknown";
  }
}

/** What `stigmer download <type> <ref>` was asked for. */
export interface DownloadRequest {
  /** The reference as typed: an id, or for an eval `<ref>[@<digest|tag>]`. */
  readonly ref: string;
  /** The resolved context organization, for a reference by slug. */
  readonly org: string;
  /** `--path`; "" takes every output. */
  readonly outputPath: string;
  /** `-o`; undefined lets the kind choose its default. */
  readonly outputDir: string | undefined;
}

/**
 * One kind's download. A kind answers in one of two ways, known before any
 * call so the command layer can refuse a flag the answer would ignore:
 * `result`, a summary the result flags (--json, --quiet) shape (an eval's
 * folder); or `files`, each File printed as it is written and the count at
 * the end (a session's outputs, a File).
 */
export type DownloadHandler =
  | {
      readonly answers: "result";
      download(client: Stigmer, request: DownloadRequest): Promise<CommandResult>;
    }
  | {
      readonly answers: "files";
      /** The word the closing count uses for what was written. */
      readonly noun: string;
      download(client: Stigmer, request: DownloadRequest, progress: ProgressSink): Promise<DownloadOutcome>;
    };

// The download handlers. Every registered kind declaring Download in the
// verb matrix must appear here — the conformance test enforces it, so the
// two cannot drift. Runs are the pre-gate alias and download through
// downloadRunOutputs.
export const DOWNLOAD_HANDLERS: ReadonlyMap<ApiResourceKind, DownloadHandler> = new Map<
  ApiResourceKind,
  DownloadHandler
>([
  [
    ApiResourceKind.eval,
    {
      answers: "result",
      async download(client, request) {
        // Lazy: the eval module carries the archive tooling, which a run's
        // own download (imported by `run`) never needs.
        const evals = await import("./eval.js");
        const { ref, version } = evals.splitEvalVersion(request.ref);
        const parsed = parseReference(ref, request.org, idPrefixOf(ApiResourceKind.eval));
        return evals.renderEvalDownload(await evals.downloadEval(client, parsed, version, request.outputDir));
      },
    },
  ],
  [
    ApiResourceKind.session,
    {
      answers: "files",
      noun: "output",
      async download(client, request, progress) {
        if (!isSessionId(request.ref)) {
          throw new UsageError(
            `invalid session ID: ${request.ref}\n\nA conversation is named by its ID (e.g., ses_01abc123)`,
          );
        }
        return downloadSessionOutputs(
          client,
          request.ref,
          { outputPath: request.outputPath, outputDir: request.outputDir ?? "." },
          progress,
        );
      },
    },
  ],
  [
    ApiResourceKind.file,
    {
      answers: "files",
      noun: "file",
      async download(client, request, progress) {
        if (request.outputPath !== "") {
          throw new UsageError("--path picks among a run's or a session's outputs; a File is one file");
        }
        const parsed = parseReference(request.ref, request.org, idPrefixOf(ApiResourceKind.file));
        if (parsed.kind !== "id") {
          throw new UsageError(`a File is named by its ID (e.g., file_01abc123), not '${request.ref}'`);
        }
        return downloadFile(client, parsed.id, request.outputDir ?? ".", progress);
      },
    },
  ],
]);
