// `download run`: write what a run returned (the Files its agent saved in
// its outputs folder) to disk, each at its place in that folder, through
// short-lived download links. Partial-failure tolerant: a File that fails is
// reported and skipped, never aborting the batch. A File's output path is
// checked by the server when the runner registers it; it is checked again
// here, so a path that would land outside the chosen directory is refused
// whatever the server answered.

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Stigmer } from "@stigmer/client";
import { CliExitError, ExitCode } from "../errors/index.js";
import { formatBytes } from "./skill.js";

export interface DownloadParams {
  /** A filename or an output path (`reports/q3.md`); empty takes every File. */
  readonly artifactName: string;
  readonly outputDir: string;
}

export interface DownloadOutcome {
  readonly total: number;
  readonly downloaded: number;
  readonly noArtifacts: boolean;
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

export async function downloadRunArtifacts(
  client: Stigmer,
  runId: string,
  params: DownloadParams,
  progress?: ProgressSink,
): Promise<DownloadOutcome> {
  const run = await client.run.get(runId);
  const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  const incompletePhase = TERMINAL_PHASES.has(phase) ? undefined : formatDownloadPhase(phase);
  if (incompletePhase !== undefined) {
    progress?.(`Run is still ${incompletePhase}. Artifacts may not be complete until the run finishes.`);
  }

  let files = await listRunFiles(client, run.metadata?.org ?? "", runId);
  if (files.length === 0) {
    return { total: 0, downloaded: 0, noArtifacts: true, incompletePhase };
  }

  if (params.artifactName !== "") {
    files = files.filter(
      (f) => f.spec?.filename === params.artifactName || f.status?.outputPath === params.artifactName,
    );
    if (files.length === 0) {
      throw new CliExitError(
        `artifact not found: ${params.artifactName}\n\n` +
          `Use 'stigmer get run ${runId}' to see available artifacts`,
        ExitCode.General,
      );
    }
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

  return { total: files.length, downloaded, noArtifacts: false, incompletePhase };
}

/**
 * The run's Files, one per place in the outputs folder: the list answers
 * newest first, so a path written twice keeps its newest File.
 */
async function listRunFiles(client: Stigmer, org: string, runId: string): Promise<File[]> {
  const byPlace = new Map<string, File>();
  for await (const file of client.file.listAll({ org, runId })) {
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
