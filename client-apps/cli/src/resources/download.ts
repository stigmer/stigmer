// `download execution`: stream an execution's artifacts to disk via short-lived
// presigned URLs. Partial-failure tolerant — a failed artifact is reported and
// skipped, never aborting the batch (mirrors Go's downloadExecutionArtifacts).

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { create } from "@bufbuild/protobuf";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { GetArtifactDownloadUrlRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { CliExitError, ExitCode } from "../errors/index.js";
import { formatBytes } from "./skill.js";

export interface DownloadParams {
  readonly artifactName: string;
  readonly outputDir: string;
}

export interface DownloadOutcome {
  readonly total: number;
  readonly downloaded: number;
  readonly noArtifacts: boolean;
  /** Set when the execution is not yet terminal (a soft warning, not an error). */
  readonly incompletePhase?: string;
}

/** A sink for human progress/warning lines (download is not byte-parity output). */
export type ProgressSink = (line: string) => void;

const TERMINAL_PHASES: ReadonlySet<ExecutionPhase> = new Set([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

export async function downloadExecutionArtifacts(
  client: Stigmer,
  executionId: string,
  params: DownloadParams,
  progress?: ProgressSink,
): Promise<DownloadOutcome> {
  const execution = await client.agentExecution.get(executionId);
  const phase = execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  const incompletePhase = TERMINAL_PHASES.has(phase) ? undefined : formatDownloadPhase(phase);
  if (incompletePhase !== undefined) {
    progress?.(`Execution is still ${incompletePhase}. Artifacts may not be complete until execution finishes.`);
  }

  let artifacts = execution.status?.artifacts ?? [];
  if (artifacts.length === 0) {
    return { total: 0, downloaded: 0, noArtifacts: true, incompletePhase };
  }

  if (params.artifactName !== "") {
    artifacts = artifacts.filter((a) => a.name === params.artifactName);
    if (artifacts.length === 0) {
      throw new CliExitError(
        `artifact not found: ${params.artifactName}\n\n` +
          `Use 'stigmer get execution ${executionId}' to see available artifacts`,
        ExitCode.General,
      );
    }
  }

  mkdirSync(params.outputDir, { recursive: true });

  let downloaded = 0;
  for (const artifact of artifacts) {
    try {
      const written = await downloadSingle(client, executionId, artifact, params.outputDir, progress);
      progress?.(`  Downloaded ${artifact.name} (${formatBytes(written)})`);
      downloaded++;
    } catch (err) {
      progress?.(`  Failed to download ${artifact.name}: ${(err as Error).message}`);
    }
  }

  return { total: artifacts.length, downloaded, noArtifacts: false, incompletePhase };
}

async function downloadSingle(
  client: Stigmer,
  executionId: string,
  artifact: ExecutionArtifact,
  outputDir: string,
  progress?: ProgressSink,
): Promise<number> {
  const url = await resolveDownloadUrl(client, executionId, artifact);
  const destPath = join(outputDir, artifact.name);
  mkdirSync(dirname(destPath), { recursive: true });

  progress?.(`  Downloading ${artifact.name} (${formatBytes(Number(artifact.sizeBytes))})...`);

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
 * Get a fresh presigned URL, falling back to the artifact's cached URL when the
 * refresh RPC fails (matching Go: prefer fresh, tolerate transient gRPC errors).
 */
async function resolveDownloadUrl(client: Stigmer, executionId: string, artifact: ExecutionArtifact): Promise<string> {
  try {
    const response = await client.agentExecution.getArtifactDownloadUrl(
      create(GetArtifactDownloadUrlRequestSchema, { executionId, storageKey: artifact.storageKey }),
    );
    if (response.downloadUrl !== "") return response.downloadUrl;
  } catch {
    // Fall through to the cached URL below.
  }
  if (artifact.downloadUrl !== "") return artifact.downloadUrl;
  throw new Error("failed to get download URL");
}

// Human-readable non-terminal phase label (matches Go's formatPhaseForDownload).
function formatDownloadPhase(phase: ExecutionPhase): string {
  switch (phase) {
    case ExecutionPhase.EXECUTION_PENDING:
      return "pending";
    case ExecutionPhase.EXECUTION_IN_PROGRESS:
      return "in progress";
    case ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
      return "waiting for approval";
    case ExecutionPhase.EXECUTION_PAUSED:
      return "paused";
    default:
      return "unknown";
  }
}
