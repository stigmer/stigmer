// `stigmer file upload`: put files on disk into Stigmer as Files, named by
// the ids the uploads mint, so a later run (`run --file-id`), a routine or
// the console can name them without sending the bytes again.
//
// Trade-offs:
// - Every path is checked before any byte moves: a missing path or a folder
//   fails the command with nothing uploaded. A folder is refused rather
//   than walked, because a folder only means something inside a
//   conversation (`run --attach` keeps its tree there); outside one it
//   would scatter its files into flat, unrelated Files.
// - The uploads share `run --attach`'s pool: a few at a time, streamed from
//   disk, and all-or-nothing, so a failed batch deletes the Files it had
//   uploaded and the same command can simply be run again.
// - Without `--session` the Files are the person's own, kept for reuse;
//   with it they are that conversation's from the start, uploaded in the
//   conversation's own organization and given to it: appended to its
//   resources, each placed by its filename (the server makes a name the
//   conversation already holds unique), so the agent finds them under
//   .stigmer/uploads/ on its next turn. A File only uploaded into a
//   conversation is never mounted.

import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  FileResourceSchema,
  SessionResourceSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { giveFilesToSession, type ProgressSink, uploadAll } from "./run/files.js";
import { formatBytes } from "./skill.js";

/** One uploaded File, as the command reports it. */
export interface UploadedFile {
  readonly id: string;
  readonly filename: string;
  readonly sizeBytes: number;
}

/** Where the Files go: an organization, and a conversation when one is named. */
export interface FileUploadTarget {
  readonly org: string;
  /**
   * The conversation the Files are given to, as read before the upload (its
   * etag guards the update); omitted keeps them the person's own.
   */
  readonly session?: Session;
}

/**
 * Upload each path as a File, in the order given. Refuses a missing path or
 * a folder before uploading anything.
 */
export async function uploadFiles(
  client: Stigmer,
  paths: readonly string[],
  target: FileUploadTarget,
  progress?: ProgressSink,
): Promise<UploadedFile[]> {
  const planned = paths.map((path) => {
    const size = fileSize(path);
    return { path: resolve(path), filename: basename(path), size };
  });
  const session = target.session;
  for (const file of planned) progress?.(`Uploading ${file.filename} (${formatBytes(file.size)})...`);
  const ids = await uploadAll(client, planned, { org: target.org, sessionId: session?.metadata?.id ?? "" }, progress);
  if (session !== undefined) {
    const resources = ids.map((fileId) =>
      create(SessionResourceSchema, {
        resource: { case: "file", value: create(FileResourceSchema, { fileId }) },
      }),
    );
    await giveFilesToSession(client, session, resources, ids, ids.length === 1 ? "the file" : "the files", progress);
  }
  return planned.map((file, i) => ({ id: ids[i], filename: file.filename, sizeBytes: file.size }));
}

/** The uploaded Files, each name beside the id that names it from now on. */
export function renderUploadedFiles(files: readonly UploadedFile[], sessionId: string): CommandResult {
  const result = CommandResult.success(
    files.length === 1 ? "Uploaded 1 file" : `Uploaded ${files.length} files`,
  );
  const section = result.addSection("Files");
  for (const file of files) section.field(file.filename, file.id);
  if (sessionId === "") {
    result.hint("Name one in a new conversation with: stigmer run <agent> --file-id <id>");
  }
  return result.withData({
    files: files.map((file) => ({ id: file.id, filename: file.filename, size_bytes: file.sizeBytes })),
  });
}

function fileSize(path: string): number {
  let stats;
  try {
    stats = statSync(path);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") throw new UsageError(`file not found: ${path}`);
    throw new UsageError(`cannot read "${path}": ${e.message}`);
  }
  if (stats.isDirectory()) {
    throw new UsageError(
      `"${path}" is a folder; attach a folder to a conversation with stigmer run --attach`,
    );
  }
  if (!stats.isFile()) {
    throw new UsageError(`cannot upload "${path}": not a file`);
  }
  return stats.size;
}
