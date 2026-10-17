/**
 * The files an eval run's graders read, as the try's turn left them.
 *
 * The server sends the workspace-relative paths its file graders name
 * (`EvalCaseContext.read_files`). The file-review ledger holds only
 * what the turn changed, so a file the scaffold wrote and the agent left
 * alone would read as absent there; Claude Code's graders read the file as
 * it is. So the runner reads exactly those paths when the turn ends and
 * returns them on the run (`RunStatus.eval_files`), where the case
 * workflow's graders read any path no change set holds.
 *
 * Each read is the agent's own (`agentFs()`), so it reaches nothing the
 * agent could not. A path that is absolute or climbs out of the workspace is
 * not read. Each file is capped at the size the status inlines a file's
 * content at, and the files together at a quarter of the status's hard
 * limit, so the reads can never push the terminal write past it; a file past
 * either cap is returned unreadable with the cap named. Binary is decided
 * the way file-review capture decides it (`bytesLookBinary`).
 */

import { join, posix } from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  type EvalFile,
  EvalFileSchema,
  type EvalFiles,
  EvalFilesSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/eval_case_pb";
import { agentFs } from "../agent-fs.js";
import { bytesLookBinary } from "../file-change.js";
import { INLINE_FILE_CONTENT_MAX_BYTES, STATUS_PAYLOAD_HARD_LIMIT_BYTES } from "../status-offload.js";

/** The most one file may hold to be returned whole. */
export const EVAL_FILE_MAX_BYTES = INLINE_FILE_CONTENT_MAX_BYTES;

/** The most the files may hold together. */
export const EVAL_FILES_MAX_BYTES = STATUS_PAYLOAD_HARD_LIMIT_BYTES / 4;

/** The file type bits of a stat mode, and a regular file's. */
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

/** Reads each path under `workspaceDir`, in the order given, once per path. */
export async function readEvalFiles(workspaceDir: string, paths: readonly string[]): Promise<EvalFiles> {
  const files: EvalFile[] = [];
  let budget = EVAL_FILES_MAX_BYTES;
  for (const path of new Set(paths)) {
    const file = await readOne(workspaceDir, path, budget);
    if (file.content.case === "text") budget -= Buffer.byteLength(file.content.value);
    files.push(file);
  }
  return create(EvalFilesSchema, { files });
}

async function readOne(workspaceDir: string, path: string, budget: number): Promise<EvalFile> {
  const of = (content: EvalFile["content"]): EvalFile => create(EvalFileSchema, { path, content });
  const relative = posix.normalize(path.trim());
  if (posix.isAbsolute(relative) || relative === ".." || relative.startsWith("../")) {
    return of({ case: "unreadable", value: `'${path}' is outside the workspace` });
  }
  const absolute = join(workspaceDir, relative);
  let size: number;
  try {
    const stats = await agentFs().stat(absolute);
    if ((stats.mode & S_IFMT) !== S_IFREG) return of({ case: "unreadable", value: `'${path}' is not a regular file` });
    size = stats.size;
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") return of({ case: "absent", value: true });
    return of({ case: "unreadable", value: `'${path}' could not be read: ${messageOf(error)}` });
  }
  if (size > EVAL_FILE_MAX_BYTES) {
    return of({ case: "unreadable", value: `'${path}' is larger than ${EVAL_FILE_MAX_BYTES / 1024} KiB` });
  }
  if (size > budget) {
    return of({ case: "unreadable", value: `the files the graders read pass ${EVAL_FILES_MAX_BYTES / 1024} KiB together` });
  }
  try {
    const bytes = await agentFs().readFile(absolute);
    if (bytesLookBinary(bytes)) return of({ case: "binary", value: true });
    return of({ case: "text", value: new TextDecoder().decode(bytes) });
  } catch (error) {
    return of({ case: "unreadable", value: `'${path}' could not be read: ${messageOf(error)}` });
  }
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
