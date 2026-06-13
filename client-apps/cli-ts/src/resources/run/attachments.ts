// Attachment processing for agent execution.
//
// Ports the Go CLI's run_attachments.go + run_attachments_zip.go. Each `--attach`
// path is either recorded as a workspace-relative reference (when it lives inside
// a local workspace root — no upload, the agent reads it directly) or uploaded
// via the UploadAttachment RPC and returned as an Attachment proto. Directories
// are zipped (hidden entries and symlinks skipped) and capped at 10 MB to match
// the server's gRPC receive limit.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { create } from "@bufbuild/protobuf";
import { zipSync } from "fflate";
import { type Attachment, AttachmentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  type UploadAttachmentRequest,
  UploadAttachmentRequestSchema,
  type UploadAttachmentResponse,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { UsageError } from "../../errors/index.js";

// Must match the server's grpc.MaxRecvMsgSize (Go: maxAttachmentSize).
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB

/** A sink for human progress/warning lines (attachments are not byte-parity output). */
export type ProgressSink = (line: string) => void;

/** The minimal UploadAttachment RPC surface, injectable for testing. */
export interface AttachmentUploader {
  uploadAttachment(req: UploadAttachmentRequest): Promise<UploadAttachmentResponse>;
}

/**
 * The split result of processing `--attach` paths. Mirrors Go's
 * AttachmentResult: in-workspace files become relative references, everything
 * else becomes an uploaded Attachment.
 */
export interface AttachmentResult {
  readonly attachments: Attachment[];
  readonly workspaceFileRefs: string[];
}

/**
 * Process `--attach` paths against the local workspace roots. The first root a
 * path falls inside wins and yields a workspace-relative reference; otherwise
 * the path is uploaded. Mirrors Go's AttachmentProcessor.ProcessFiles.
 */
export async function processAttachments(
  uploader: AttachmentUploader,
  paths: readonly string[],
  workspaceRoots: readonly string[],
  progress?: ProgressSink,
): Promise<AttachmentResult> {
  const attachments: Attachment[] = [];
  const workspaceFileRefs: string[] = [];
  if (paths.length === 0) return { attachments, workspaceFileRefs };

  for (const path of paths) {
    const rel = matchWorkspaceRoot(path, workspaceRoots);
    if (rel !== null) {
      progress?.(`Referencing workspace file: ${rel}`);
      workspaceFileRefs.push(rel);
      continue;
    }
    attachments.push(await processFile(uploader, path, progress));
  }

  return { attachments, workspaceFileRefs };
}

// Returns the workspace-relative path if `path` is inside any root (first match
// wins), else null. Mirrors Go's matchWorkspaceRoot + workspaceRelativePath:
// both sides are resolved through realpath to prevent symlink escapes.
function matchWorkspaceRoot(path: string, roots: readonly string[]): string | null {
  for (const root of roots) {
    let evalFile: string;
    let evalRoot: string;
    try {
      evalFile = realpathSync(resolve(path));
      evalRoot = realpathSync(root);
    } catch {
      continue; // unresolvable path is treated as outside this root
    }
    if (evalFile === evalRoot || evalFile.startsWith(evalRoot + sep)) {
      return toSlash(relative(evalRoot, evalFile));
    }
  }
  return null;
}

// Stat the path, then upload a file or zip+upload a directory. Mirrors Go's
// processFile.
async function processFile(uploader: AttachmentUploader, path: string, progress?: ProgressSink): Promise<Attachment> {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") throw new UsageError(`file not found: ${path}`);
    throw new UsageError(`failed to stat attachment "${path}": ${e.message}`);
  }

  if (stat.isDirectory()) return processDirectory(uploader, path, progress);

  const absPath = resolve(path);
  const filename = basenameOf(path);
  const contentType = detectContentType(filename);
  progress?.(`Uploading ${filename} (${formatFileSize(stat.size)})...`);
  const attachment = await uploadBytes(uploader, readFileSync(path), filename, contentType, progress);
  attachment.localPath = absPath;
  return attachment;
}

// Zip a directory (extract=true so the runner unpacks it at mount_path) and
// upload it as one archive. Mirrors Go's processDirectory.
async function processDirectory(uploader: AttachmentUploader, path: string, progress?: ProgressSink): Promise<Attachment> {
  const absPath = resolve(path);
  const dirname = basenameOf(absPath);

  const { bytes, fileCount, originalSize } = zipDirectory(absPath, progress);
  const zipSize = bytes.byteLength;
  progress?.(
    `Zipping directory: ${dirname}/ (${fileCount} files, ` +
      `${formatFileSize(originalSize)} -> ${formatFileSize(zipSize)} compressed)`,
  );
  if (zipSize > MAX_ATTACHMENT_SIZE) {
    throw new UsageError(
      `zipped directory too large (${formatFileSize(zipSize)}). ` +
        `Maximum attachment size is ${formatFileSize(MAX_ATTACHMENT_SIZE)}`,
    );
  }

  const attachment = await uploadBytes(uploader, bytes, `${dirname}.zip`, "application/zip", progress);
  attachment.extract = true;
  attachment.mountPath = `inputs/${dirname}/`;
  attachment.localPath = absPath;
  return attachment;
}

// Upload raw bytes via the RPC and build an Attachment. Mirrors Go's uploadBytes.
async function uploadBytes(
  uploader: AttachmentUploader,
  content: Uint8Array,
  filename: string,
  contentType: string,
  progress?: ProgressSink,
): Promise<Attachment> {
  const req = create(UploadAttachmentRequestSchema, { filename, content, contentType });
  let resp: UploadAttachmentResponse;
  try {
    resp = await uploader.uploadAttachment(req);
  } catch (err) {
    throw new UsageError(`failed to upload attachment "${filename}": ${(err as Error).message}`);
  }
  progress?.(`Uploaded ${filename}`);
  return create(AttachmentSchema, { filename, storageKey: resp.storageKey, contentType });
}

interface ZipResult {
  readonly bytes: Uint8Array;
  readonly fileCount: number;
  readonly originalSize: number;
}

// Build a zip of dirPath's contents, skipping hidden entries (and their
// subtrees) and symlinks. Mirrors Go's zipDirectory.
function zipDirectory(dirPath: string, progress?: ProgressSink): ZipResult {
  const files: Record<string, Uint8Array> = {};
  let fileCount = 0;
  let originalSize = 0;

  const walk = (current: string, prefix: string): void => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // hidden entry (and subtree if dir)
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        progress?.(`Skipping symlink: ${full}`);
        continue;
      }
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = new Uint8Array(readFileSync(full));
      files[rel] = content;
      fileCount++;
      originalSize += content.byteLength;
    }
  };
  walk(dirPath, "");

  if (fileCount === 0) {
    throw new UsageError(`directory contains no attachable files: ${dirPath}`);
  }

  return { bytes: zipSync(files, { level: 6 }), fileCount, originalSize };
}

// MIME by extension. Go consults the OS mime DB first (non-deterministic across
// hosts) and falls back to a fixed switch; we use a curated table so the result
// is deterministic. content_type is advisory — the server re-guesses from the
// filename when absent — so exact parity with Go's OS DB is not required.
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".toml": "application/toml",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".log": "text/plain",
  ".sql": "application/sql",
  ".parquet": "application/vnd.apache.parquet",
  ".avro": "application/avro",
  ".json": "application/json",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "text/xml",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".js": "text/javascript",
  ".ts": "text/plain",
};

function detectContentType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (ext === "") return "application/octet-stream";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

// Human-readable byte size. Mirrors Go's formatFileSize (1024-based, one decimal).
function formatFileSize(bytes: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

// path.basename, but resilient to trailing slashes (matches Go filepath.Base
// semantics closely enough for display/name derivation).
function basenameOf(p: string): string {
  const cleaned = p.replace(/[/\\]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  return idx === -1 ? cleaned : cleaned.slice(idx + 1);
}

function toSlash(p: string): string {
  return p.split(sep).join("/");
}
