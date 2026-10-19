// What `--attach` gives a run: each path is a file the message carries, a
// folder the conversation holds, or a mention of a file already in a local
// workspace.
//
// A file outside every local workspace is uploaded as a File and named in the
// run's file_ids: the model sees it with the message (an image as an image,
// anything else as a document) and the agent finds it under .stigmer/uploads/.
// A folder is uploaded file by file and joins the conversation's resources,
// each File's mount_path keeping its place under the folder's name, so the
// tree arrives as it was without a message block per file. A path inside a
// local workspace root is a workspace_file_refs mention: the agent reads it
// where it is, and nothing is uploaded.
//
// Trade-offs:
// - Planning and uploading are two steps. planAttachments only reads the
//   disk, so a missing path, an empty folder or a count over the limits fails
//   before any byte moves; stageAttachments uploads once the run's target is
//   known.
// - Into an existing conversation a File is uploaded with its session id and
//   is the conversation's at once. A new conversation does not exist until
//   its first run does, so each File is uploaded as the person's own and the
//   server copies it into the conversation when the run names it. The
//   originals are then deleted (deleteFiles), the conversation's copies
//   keeping the bytes; they are deleted as well when the run is never
//   created, since nothing names them.
// - Files stream from disk (uploadFileFromPath), so a large file is never
//   read into memory, and a few upload at a time. When one fails, the Files
//   already uploaded are deleted before the error surfaces.
// - Inside a folder, hidden entries (and their subtrees) and symbolic links
//   are skipped: a folder's dotfiles are usually tool state or credentials,
//   and a link can reach outside the folder.
// - Two folders with one name (`--attach a/data --attach b/data`), or a
//   folder named like one the conversation already holds, would claim the
//   same mount paths, so the later one is renamed data-2 and the rename is
//   reported.

import { readdirSync, realpathSync, type Stats, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { create } from "@bufbuild/protobuf";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import {
  FileResourceSchema,
  type SessionResource,
  SessionResourceSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import type { Stigmer } from "@stigmer/client";
import { uploadFileFromPath } from "@stigmer/client/node";
import { UsageError } from "../../errors/index.js";

/** A sink for human progress and warning lines. */
export type ProgressSink = (line: string) => void;

/** The most Files one message carries (RunSpec.file_ids). */
export const MAX_MESSAGE_FILES = 20;

/** The most Files a conversation holds (SessionSpec.resources). */
export const MAX_CONVERSATION_FILES = 500;

const UPLOAD_CONCURRENCY = 4;

/** A file on disk to upload. */
export interface LocalFile {
  /** Absolute path. */
  readonly path: string;
  readonly size: number;
}

/** A file inside an attached folder, by its slash-separated path under the folder. */
export interface FolderFile extends LocalFile {
  readonly relativePath: string;
}

/** An attached folder and every file it gives. */
export interface AttachedFolder {
  /** The folder's own name: the first segment of each of its Files' mount paths. */
  readonly name: string;
  readonly files: readonly FolderFile[];
}

/** What the `--attach` paths resolved to, before anything is uploaded. */
export interface AttachmentPlan {
  /** Files the message carries, in the order given. */
  readonly messageFiles: readonly LocalFile[];
  /** Folders the conversation holds, in the order given. */
  readonly folders: readonly AttachedFolder[];
  /** Workspace-relative paths of files already in a local workspace. */
  readonly workspaceFileRefs: readonly string[];
}

/** A plan that attaches nothing. */
export const NO_ATTACHMENTS: AttachmentPlan = { messageFiles: [], folders: [], workspaceFileRefs: [] };

/**
 * Resolve `--attach` paths against the local workspace roots without
 * uploading anything. The first root a path falls inside makes it a
 * workspace-relative mention; any other file is carried by the message; a
 * folder is walked for the files it gives.
 */
export function planAttachments(
  paths: readonly string[],
  workspaceRoots: readonly string[],
  progress?: ProgressSink,
): AttachmentPlan {
  const messageFiles: LocalFile[] = [];
  const folders: AttachedFolder[] = [];
  const workspaceFileRefs: string[] = [];
  const budget = { remaining: MAX_CONVERSATION_FILES };

  for (const path of paths) {
    const rel = matchWorkspaceRoot(path, workspaceRoots);
    if (rel !== null) {
      progress?.(`Referencing workspace file: ${rel}`);
      workspaceFileRefs.push(rel);
      continue;
    }
    const abs = resolve(path);
    const stat = statAttachment(path);
    if (stat.isDirectory()) {
      folders.push(readFolder(abs, budget, progress));
    } else if (stat.isFile()) {
      messageFiles.push({ path: abs, size: stat.size });
    } else {
      throw new UsageError(`cannot attach "${path}": not a file or a folder`);
    }
  }

  if (messageFiles.length > MAX_MESSAGE_FILES) {
    throw new UsageError(
      `--attach names ${messageFiles.length} files; a message carries at most ${MAX_MESSAGE_FILES} (attach a folder to give more)`,
    );
  }
  const total = messageFiles.length + folders.reduce((n, folder) => n + folder.files.length, 0);
  if (total > MAX_CONVERSATION_FILES) {
    throw new UsageError(`--attach gives ${total} files; a conversation holds at most ${MAX_CONVERSATION_FILES}`);
  }
  return { messageFiles, folders, workspaceFileRefs };
}

/** Where the attached Files go: the run's organization, and its conversation when it exists. */
export interface StageTarget {
  readonly org: string;
  /** The existing conversation the run continues; omitted for a new one. */
  readonly sessionId?: string;
}

/** The uploaded Files, ready for the run that names them. */
export interface StagedAttachments {
  /** The Files the message carries, for RunSpec.file_ids. */
  readonly fileIds: readonly string[];
  /**
   * The folders' Files as resources for a new conversation's session_spec.
   * Empty for an existing conversation, whose resources already hold them.
   */
  readonly resources: readonly SessionResource[];
  /** The person's own Files uploaded for a new conversation: delete them once the run exists. */
  readonly originals: readonly string[];
}

const NOTHING_STAGED: StagedAttachments = { fileIds: [], resources: [], originals: [] };

interface UploadJob {
  readonly path: string;
  readonly filename: string;
}

/**
 * Upload what the plan attaches. Into an existing conversation, the Files are
 * the conversation's and the folders' Files join its resources through a
 * masked update that keeps every resource it holds. For a new one, the Files
 * are the person's own, returned as originals for the caller to delete once
 * the run exists.
 */
export async function stageAttachments(
  client: Stigmer,
  plan: AttachmentPlan,
  target: StageTarget,
  progress?: ProgressSink,
): Promise<StagedAttachments> {
  if (plan.messageFiles.length === 0 && plan.folders.length === 0) return NOTHING_STAGED;
  const sessionId = target.sessionId ?? "";
  const session = sessionId === "" ? undefined : await client.session.get(sessionId);

  const taken = new Set(session === undefined ? [] : heldTopLevelNames(session));
  const jobs: UploadJob[] = plan.messageFiles.map((file) => ({ path: file.path, filename: basename(file.path) }));
  for (const file of plan.messageFiles) {
    progress?.(`Uploading ${basename(file.path)} (${formatFileSize(file.size)})...`);
  }
  const mountPaths: string[] = [];
  for (const folder of plan.folders) {
    const name = uniquifyName(folder.name, taken);
    taken.add(name);
    if (name !== folder.name) {
      progress?.(
        `Attaching second '${folder.name}/' as '${name}/' (a folder named '${folder.name}' is already attached)`,
      );
    }
    const size = folder.files.reduce((n, file) => n + file.size, 0);
    progress?.(`Uploading folder ${name}/ (${folder.files.length} files, ${formatFileSize(size)})...`);
    for (const file of folder.files) {
      jobs.push({ path: file.path, filename: basename(file.path) });
      mountPaths.push(`${name}/${file.relativePath}`);
    }
  }

  const ids = await uploadAll(client, jobs, { org: target.org, sessionId }, progress);
  const fileIds = ids.slice(0, plan.messageFiles.length);
  const resources = ids.slice(plan.messageFiles.length).map((fileId, i) =>
    create(SessionResourceSchema, {
      resource: { case: "file", value: create(FileResourceSchema, { fileId, mountPath: mountPaths[i] }) },
    }),
  );

  if (session === undefined) return { fileIds, resources, originals: ids };
  if (resources.length > 0) {
    try {
      await client.session.update(
        {
          metadata: { id: sessionId, etag: session.metadata?.etag ?? "" },
          spec: { resources: [...(session.spec?.resources ?? []), ...resources] },
        },
        ["spec.resources"],
      );
    } catch (err) {
      await deleteFiles(client, ids, progress);
      throw new UsageError(`failed to add the attached folders to the conversation: ${errorMessage(err)}`);
    }
  }
  return { fileIds, resources: [], originals: [] };
}

/**
 * Delete Files the run no longer needs, reporting each one that could not be
 * deleted rather than failing: the run already holds what it needs.
 */
export async function deleteFiles(
  client: Stigmer,
  ids: readonly string[],
  warn?: ProgressSink,
): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      try {
        await client.file.delete(id);
      } catch (err) {
        warn?.(`Could not delete the uploaded File ${id}: ${errorMessage(err)}`);
      }
    }),
  );
}

// Upload every job a few at a time, keeping the jobs' order in the ids. On
// the first failure no new upload starts; once the ones in flight settle,
// every File uploaded is deleted and the failure surfaces.
async function uploadAll(
  client: Stigmer,
  jobs: readonly UploadJob[],
  target: { readonly org: string; readonly sessionId: string },
  progress?: ProgressSink,
): Promise<string[]> {
  const ids = jobs.map(() => "");
  let next = 0;
  let failure: UsageError | undefined;
  const worker = async (): Promise<void> => {
    while (failure === undefined && next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      try {
        const file = await uploadFileFromPath(client.file, { ...target, path: job.path, filename: job.filename });
        ids[index] = file.metadata?.id ?? "";
      } catch (err) {
        failure ??= new UsageError(`failed to upload "${job.path}": ${errorMessage(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, jobs.length) }, worker));
  if (failure !== undefined) {
    await deleteFiles(
      client,
      ids.filter((id) => id !== ""),
      progress,
    );
    throw failure;
  }
  return ids;
}

// The first path segment of every File the conversation holds: the names a
// newly attached folder must not take.
function heldTopLevelNames(session: Session): string[] {
  const names: string[] = [];
  for (const resource of session.spec?.resources ?? []) {
    if (resource.resource.case !== "file") continue;
    const mountPath = resource.resource.value.mountPath;
    if (mountPath !== "") names.push(mountPath.split("/")[0]);
  }
  return names;
}

// Returns the workspace-relative path if `path` is inside any root (first
// match wins), else null. Both sides are resolved through realpath so a
// symbolic link cannot pass a file outside the root off as inside it.
function matchWorkspaceRoot(path: string, roots: readonly string[]): string | null {
  for (const root of roots) {
    let evalFile: string;
    let evalRoot: string;
    try {
      evalFile = realpathSync(resolve(path));
      evalRoot = realpathSync(root);
    } catch {
      continue; // an unresolvable path is outside this root
    }
    if (evalFile === evalRoot || evalFile.startsWith(evalRoot + sep)) {
      return relative(evalRoot, evalFile).split(sep).join("/");
    }
  }
  return null;
}

function statAttachment(path: string): Stats {
  try {
    return statSync(path);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") throw new UsageError(`file not found: ${path}`);
    throw new UsageError(`failed to stat attachment "${path}": ${e.message}`);
  }
}

// Every regular file under the folder, hidden entries and symbolic links
// skipped. Stops as soon as the files found exceed the conversation's limit,
// so attaching a large tree by mistake fails fast instead of walking it all.
function readFolder(
  abs: string,
  budget: { remaining: number },
  progress?: ProgressSink,
): AttachedFolder {
  const files: FolderFile[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        progress?.(`Skipping symlink: ${full}`);
      } else if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        budget.remaining -= 1;
        if (budget.remaining < 0) {
          throw new UsageError(
            `--attach gives more than ${MAX_CONVERSATION_FILES} files; a conversation holds at most ${MAX_CONVERSATION_FILES}`,
          );
        }
        files.push({ path: full, size: statSync(full).size, relativePath: rel });
      }
    }
  };
  walk(abs, "");
  if (files.length === 0) {
    throw new UsageError(`directory contains no attachable files: ${abs}`);
  }
  const name = basename(abs);
  return { name: name === "" ? "folder" : name, files };
}

// Returns `name` unchanged when free, otherwise the first free `name-2`,
// `name-3`, ... variant. Extension-blind: a folder name has no extension
// ("reports.2024" becomes "reports.2024-2").
function uniquifyName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Human-readable byte size: 1024-based, one decimal.
function formatFileSize(bytes: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
