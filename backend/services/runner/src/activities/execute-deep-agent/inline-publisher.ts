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
import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import type { StatusBuilder } from "./status-builder.js";
import { utcTimestamp } from "../../shared/status.js";

export class InlinePublisher {
  private readonly workspaceBackend: WorkspaceBackend;
  private readonly artifactStorage: ArtifactStorage;
  private readonly statusBuilder: StatusBuilder;
  private readonly executionId: string;

  /** Tracks (sandboxPath -> contentHash) for deduplication. */
  private readonly published = new Map<string, string>();

  constructor(opts: {
    workspaceBackend: WorkspaceBackend;
    artifactStorage: ArtifactStorage;
    statusBuilder: StatusBuilder;
    executionId: string;
  }) {
    this.workspaceBackend = opts.workspaceBackend;
    this.artifactStorage = opts.artifactStorage;
    this.statusBuilder = opts.statusBuilder;
    this.executionId = opts.executionId;
  }

  /** Set of sandbox paths that have been published (for auto-publish dedup). */
  get publishedPaths(): ReadonlySet<string> {
    return new Set(this.published.keys());
  }

  /**
   * Upload the file at `path` to artifact storage and register it on the
   * status builder. Fire-and-forget: errors are logged and swallowed.
   */
  async publish(path: string): Promise<void> {
    try {
      const sandboxPath = normalizePath(path);

      const content = await this.workspaceBackend.readFile(sandboxPath);
      const contentBuffer = Buffer.from(content, "utf-8");
      const contentHash = sha256(contentBuffer);

      if (this.published.get(sandboxPath) === contentHash) {
        return;
      }

      const fileName = basename(sandboxPath);
      const storageKey = `artifacts/${this.executionId}/${fileName}`;

      await this.artifactStorage.upload(storageKey, contentBuffer, guessContentType(fileName));
      const downloadUrl = await this.artifactStorage.getDownloadUrl(storageKey);

      const artifact = create(ExecutionArtifactSchema, {
        name: fileName,
        sandboxPath,
        kind: ExecutionArtifactKind.FILE,
        sizeBytes: BigInt(contentBuffer.length),
        storageKey,
        downloadUrl,
        createdAt: utcTimestamp(),
        contentHash,
      });

      this.statusBuilder.addArtifact(artifact);
      this.published.set(sandboxPath, contentHash);

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
