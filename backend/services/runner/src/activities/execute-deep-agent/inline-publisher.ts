/**
 * Inline artifact publisher for streaming execution.
 *
 * Publishes artifacts as they are written during the LangGraph event stream,
 * so the UI can display them in real time without waiting for the post-stream
 * safety net.
 *
 * Designed as a fire-and-forget callback: exceptions are logged and
 * swallowed so the streaming loop is never interrupted.
 *
 * A file is uploaded only when its bytes differ from the row the execution's
 * status already lists for its path. The status is the one home of that fact:
 * the builder writes every row into it, and a reinvocation's seed carries the
 * earlier turns' rows onto it before this publisher exists. So a completed
 * turn after a gate, whose safety net walks the seeded history again, re-reads
 * each earlier file but uploads none that did not change (stigmer/stigmer#1448).
 * The re-read is kept on purpose: a shell command may have rewritten an earlier
 * turn's file, and only its bytes can say so.
 *
 * DD-7: No skill-aware directory publishing. Individual files only.
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import {
  ExecutionArtifactKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import { utcTimestamp } from "../../shared/status.js";
import { isSecretLikePath } from "../../shared/filereview/secret-paths.js";

/**
 * Where a published artifact is registered: the one member of the transcript
 * builder this publisher needs (`harness/transcript/builder.ts` `addArtifact`,
 * which owns the upsert rule and marks the transcript dirty so the row
 * reaches the next persist). Declared here as the narrow view this consumer
 * needs, never the whole builder — the `SessionProvisionConfig` rule.
 */
export interface ArtifactSink {
  addArtifact(artifact: ExecutionArtifact): void;
}

/**
 * The execution status's artifact rows, read at every publish: the status the
 * {@link ArtifactSink} builds into (`TurnSink.status` in production), so a row
 * registered here or seeded by a reinvocation is visible on the next check.
 * Read, never copied, because the builder keeps writing it.
 */
export interface ArtifactRecord {
  readonly artifacts: readonly ExecutionArtifact[];
}

export class InlinePublisher {
  private readonly workspaceBackend: WorkspaceBackend;
  /**
   * `undefined` when the runner has no artifact store (proxy misconfig). Inline
   * publishing is a best-effort real-time UI nicety, so {@link publish} becomes a
   * no-op — the operator was already warned once at setup, and the transcript still
   * persists without the offloaded artifact.
   */
  private readonly artifactStorage: ArtifactStorage | undefined;
  private readonly artifacts: ArtifactSink;
  private readonly record: ArtifactRecord;
  private readonly executionId: string;

  /**
   * Paths this publisher brought up to date in this turn, uploaded or found
   * unchanged, so the post-stream safety net does not read them again. Per
   * turn by design: an earlier turn's path is absent until this turn checks
   * it, so a file rewritten outside a write tool is still caught.
   */
  private readonly published = new Set<string>();

  constructor(opts: {
    workspaceBackend: WorkspaceBackend;
    artifactStorage: ArtifactStorage | undefined;
    artifacts: ArtifactSink;
    record: ArtifactRecord;
    executionId: string;
  }) {
    this.workspaceBackend = opts.workspaceBackend;
    this.artifactStorage = opts.artifactStorage;
    this.artifacts = opts.artifacts;
    this.record = opts.record;
    this.executionId = opts.executionId;
  }

  /** Set of sandbox paths brought up to date this turn (for auto-publish dedup). */
  get publishedPaths(): ReadonlySet<string> {
    return new Set(this.published);
  }

  /**
   * Upload the file at `path` to artifact storage and register it on the
   * status builder. Fire-and-forget: errors are logged and swallowed.
   *
   * The artifact's `createdAt` is read here, before the first await: the
   * stream asks for the publish in the step that folds the write's finish, so
   * the stamp is the write's, never the moment a slow upload returned.
   */
  async publish(path: string): Promise<void> {
    const createdAt = utcTimestamp();
    // No artifact store (proxy misconfig): nothing to upload to. Skip silently —
    // this is a best-effort UI publisher and the operator was warned at setup.
    if (!this.artifactStorage) return;
    try {
      const sandboxPath = normalizePath(path);

      // Never publish a secret-like file to durable artifact storage (design
      // doc 12, D4). This is the third secret-withholding choke point beside the
      // CAS capture gate and the transcript args scrub: under the global bypass
      // (spec.auto_approve_all) a secret write is not blocked up front, so it
      // would otherwise be uploaded here (keyed by basename) and registered as an
      // ExecutionArtifact. Fail-closed and unconditional — the same name-based
      // gate the capture path uses, so the decision has one source of truth.
      if (isSecretLikePath(sandboxPath)) {
        console.log(
          `[InlinePublisher] execution=${this.executionId} — withheld '${sandboxPath}' ` +
          `(secret-like; never published to artifact storage)`,
        );
        return;
      }

      const content = await this.workspaceBackend.readFile(sandboxPath);
      const contentBuffer = Buffer.from(content, "utf-8");
      const contentHash = sha256(contentBuffer);

      if (this.isRecorded(sandboxPath, contentHash)) {
        this.published.add(sandboxPath);
        return;
      }

      const fileName = basename(sandboxPath);
      const storageKey = `artifacts/${this.executionId}/${fileName}`;

      await this.artifactStorage.upload(storageKey, contentBuffer, guessContentType(fileName));

      const artifact = create(ExecutionArtifactSchema, {
        name: fileName,
        sandboxPath,
        kind: ExecutionArtifactKind.FILE,
        sizeBytes: BigInt(contentBuffer.length),
        storageKey,
        createdAt,
        contentHash,
      });

      this.artifacts.addArtifact(artifact);
      this.published.add(sandboxPath);

      console.log(
        `[InlinePublisher] execution=${this.executionId} — published '${sandboxPath}' ` +
        `(${contentBuffer.length} bytes, hash=${contentHash.slice(0, 12)})`,
      );
    } catch (err) {
      console.warn(
        `[InlinePublisher] execution=${this.executionId} — ` +
        `failed to publish '${path}' (non-fatal): ${err}`,
      );
    }
  }

  /** Whether the status already lists these exact bytes at this path. */
  private isRecorded(sandboxPath: string, contentHash: string): boolean {
    return this.record.artifacts.some(
      (a) => a.sandboxPath === sandboxPath && a.contentHash === contentHash,
    );
  }
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "");
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

const CONTENT_TYPE_MAP: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".js": "application/javascript",
  ".ts": "application/typescript",
  ".py": "text/x-python",
  ".html": "text/html",
  ".css": "text/css",
  ".xml": "text/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function guessContentType(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return CONTENT_TYPE_MAP[ext] ?? "application/octet-stream";
}
