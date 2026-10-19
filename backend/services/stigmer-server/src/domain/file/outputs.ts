/**
 * RunFileController's outbound half: what an agent saved in its outputs
 * folder (.stigmer/outputs/) comes back as Files of its conversation.
 * The runner collects a turn's new or changed outputs when the turn
 * settles, asks createOutputUploads for one upload link each, puts each
 * file's bytes to its link, and registerOutputs makes each a File.
 *
 * The gate. As the mount's: skip-authorization, the authority the runner
 * credential acting for this run (runnerauth/runner-for-run.ts), every
 * refusal of the credential the same PERMISSION_DENIED. A finished run
 * returns nothing, with one exception: a stop. A person's stop records
 * RUN_CANCELLED (stop_cause "user") on the run before the runner settles,
 * and the runner collects what the agent saved before it while it
 * settles; so a stopped run may mint its uploads for OUTPUT_GRACE_MS after
 * it finished, and register them with no window, since their references
 * were minted inside it and expire with their links. A failed or
 * terminated run mints nothing.
 *
 * What a File of an output is. Its filename the path's last segment and
 * its type read from the extension; its status the run's conversation,
 * the run, and output_path, the path under the outputs folder, so two
 * files of one name in two folders are two Files a person can tell apart.
 * It is owned by the person who started the run, private, and reached by
 * the conversation's people through the conversation, as an upload into
 * it is. It is not added to the conversation's resources: the agent still
 * finds it in its outputs folder, where it saved it.
 *
 * Retries. A staged reference is spent by its first promotion, so a
 * registration that is retried after it promoted must not promote again.
 * Each File's id is derived from the organization, the run, the output's
 * path and its content's hash (the runner's word, used for nothing else),
 * and registration looks that id up first: a retry answers the File it
 * already made. A reference spent with no File behind it (a promotion that
 * failed after its claim) is FAILED_PRECONDITION; the runner mints that
 * output again.
 *
 * The output path is the runner's word too, so the server holds it to the
 * rule FileStatus.output_path states before it names anything.
 *
 * Proven by __tests__/outputs.test.ts.
 */
import type { HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import {
  OutputUploadSchema,
  OutputUploadsSchema,
  RegisteredOutputsSchema,
} from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import type {
  CreateOutputUploadsInput,
  OutputUpload,
  OutputUploads,
  RegisterOutputsInput,
  RegisteredOutputs,
} from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  permissionDeniedError,
} from "../../pipeline/errors.js";
import { parseBearerToken } from "../../pipeline/interceptors/auth.js";
import { resolveResourceCreatedEvent } from "../../pipeline/steps/authorization-tuples.js";
import { setAuditFieldsForCreate } from "../../pipeline/steps/defaults.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import { isRunnerForRun } from "../../runnerauth/runner-for-run.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { isTerminalExecutionPhase } from "../run/phases.js";
import type { FileBlobs } from "./blobs.js";
import { derivedFileId } from "./convert-attachments.js";
import { fileMimeType } from "./mime.js";
import { fileNameOf } from "./steps.js";

/** The one refusal every caller outside the gate gets, whatever the reason. */
export const NOT_THE_RUNS_RUNNER_OUTPUTS_MESSAGE = "only the runner acting for this run may return its outputs";

/** How long after a person's stop the stopped run may still mint its outputs' uploads. */
export const OUTPUT_GRACE_MS = 2 * 60 * 1000;

/** The most outputs one turn returns (the contract's repeated cap). */
export const MAX_OUTPUTS_PER_TURN = 500;

/** The longest output path, in UTF-8 bytes. */
const MAX_OUTPUT_PATH_BYTES = 1024;

/** The longest filename, in characters (UploadFileInput.filename's rule). */
const MAX_FILENAME_CHARS = 255;

/** A backslash or a control character: never part of an output path. */
const REFUSED_PATH_CHARACTER = /[\\\u0000-\u001f\u007f]/;

export interface OutputDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly runnerAuth: RunnerCredentialProvider;
  readonly blobs: FileBlobs;
  /** The composed tuple-lifecycle driver; undefined writes no access (an install with no authorization store). */
  readonly lifecycle: ResourceAuthorizationLifecycle | undefined;
  /** Injectable for the grace tests; milliseconds. */
  readonly now?: () => number;
}

/**
 * Why `outputPath` is not an output path, or undefined when it is: the
 * path under .stigmer/outputs/, "/"-separated, with no empty, "." or ".."
 * segment and no leading "/", at most 1024 bytes, its last segment a
 * filename an upload could carry.
 */
export function outputPathProblem(outputPath: string): string | undefined {
  if (outputPath === "") {
    return "output_path is required";
  }
  if (Buffer.byteLength(outputPath, "utf8") > MAX_OUTPUT_PATH_BYTES) {
    return `output_path is longer than ${MAX_OUTPUT_PATH_BYTES} bytes`;
  }
  if (REFUSED_PATH_CHARACTER.test(outputPath)) {
    return "output_path holds a backslash or a control character";
  }
  const segments = outputPath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "output_path must be relative, with no empty, '.' or '..' segment";
  }
  const filename = segments[segments.length - 1] ?? "";
  if ([...filename].length > MAX_FILENAME_CHARS) {
    return `output_path's filename is longer than ${MAX_FILENAME_CHARS} characters`;
  }
  return undefined;
}

/** An output File's filename: the last segment of its path. */
export function outputFilename(outputPath: string): string {
  return outputPath.slice(outputPath.lastIndexOf("/") + 1);
}

/**
 * An output File's id, derived from what makes it this output: its
 * organization, run, path and content's hash. The tag keeps it from any
 * conversion's id (convert-attachments.ts), whose material begins with a
 * run id.
 */
export function outputFileId(org: string, runId: string, outputPath: string, contentSha256: string): string {
  return derivedFileId(["stigmer.run-output", org, runId, outputPath, contentSha256].join("\u0000"));
}

/** Mints one staged upload per output the turn saved (module header). */
export async function createOutputUploads(
  deps: OutputDeps,
  input: CreateOutputUploadsInput,
  ctx: HandlerContext,
): Promise<OutputUploads> {
  refuseMalformedEntries(input.runId, input.entries.map((entry) => entry.outputPath));
  const run = await admitRunner(deps, input.runId, ctx, "mint");
  const org = run.metadata?.org ?? "";
  const entries: OutputUpload[] = [];
  for (const entry of input.entries) {
    const minted = await deps.blobs.mintUpload(org, Number(entry.sizeBytes));
    entries.push(
      create(OutputUploadSchema, {
        outputPath: entry.outputPath,
        uploadRef: minted.ref,
        url: minted.url,
        ttlSeconds: Math.floor(minted.ttlMs / 1000),
      }),
    );
  }
  return create(OutputUploadsSchema, { entries });
}

/** Makes each uploaded output a File of the run's conversation (module header). */
export async function registerOutputs(
  deps: OutputDeps,
  input: RegisterOutputsInput,
  ctx: HandlerContext,
): Promise<RegisteredOutputs> {
  refuseMalformedEntries(input.runId, input.entries.map((entry) => entry.outputPath));
  const run = await admitRunner(deps, input.runId, ctx, "register");
  const files: File[] = [];
  for (const entry of input.entries) {
    files.push(await registerOne(deps, run, entry.outputPath, entry.uploadRef, entry.contentSha256));
  }
  return create(RegisteredOutputsSchema, { files });
}

/** The request's own shape, held before anything is read: the interceptor's rules, and the path rule. */
function refuseMalformedEntries(runId: string, outputPaths: readonly string[]): void {
  if (runId === "") {
    throw invalidArgumentError("run_id is required");
  }
  if (outputPaths.length === 0 || outputPaths.length > MAX_OUTPUTS_PER_TURN) {
    throw invalidArgumentError(`a turn returns between 1 and ${MAX_OUTPUTS_PER_TURN} outputs`);
  }
  const seen = new Set<string>();
  for (const outputPath of outputPaths) {
    const problem = outputPathProblem(outputPath);
    if (problem !== undefined) {
      throw invalidArgumentError(problem);
    }
    if (seen.has(outputPath)) {
      throw invalidArgumentError(`output_path '${outputPath}' is named twice`);
    }
    seen.add(outputPath);
  }
}

/**
 * The runner acting for this run, on a run that may still return outputs:
 * unfinished, or stopped by a person (within the grace, to mint).
 */
async function admitRunner(
  deps: OutputDeps,
  runId: string,
  ctx: HandlerContext,
  step: "mint" | "register",
): Promise<Run> {
  const token = parseBearerToken(ctx.requestHeader.get("authorization") ?? "");
  if (token === "" || !(await isRunnerForRun(deps, token, runId))) {
    throw permissionDeniedError(NOT_THE_RUNS_RUNNER_OUTPUTS_MESSAGE);
  }
  let run: Run;
  try {
    run = await deps.store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw permissionDeniedError(NOT_THE_RUNS_RUNNER_OUTPUTS_MESSAGE);
    }
    throw internalError(error, "failed to load the run");
  }
  const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  if (!isTerminalExecutionPhase(phase)) {
    return run;
  }
  const stoppedByPerson = phase === RunPhase.RUN_CANCELLED && run.status?.stopCause === "user";
  if (stoppedByPerson && step === "register") {
    return run;
  }
  if (stoppedByPerson) {
    const finishedAtMs = Date.parse(run.status?.completedAt ?? "");
    const nowMs = (deps.now ?? Date.now)();
    if (Number.isFinite(finishedAtMs) && nowMs - finishedAtMs <= OUTPUT_GRACE_MS) {
      return run;
    }
  }
  throw failedPreconditionError(`run '${runId}' is finished; it returns no outputs`);
}

async function registerOne(
  deps: OutputDeps,
  run: Run,
  outputPath: string,
  uploadRef: string,
  contentSha256: string,
): Promise<File> {
  const runId = run.metadata?.id ?? "";
  const org = run.metadata?.org ?? "";
  const target = run.spec?.target;
  const sessionId = target?.case === "sessionId" ? target.value : "";
  const id = outputFileId(org, runId, outputPath, contentSha256);

  const creator = run.status?.audit?.specAudit?.createdBy?.id ?? "";
  const caller: CallerIdentity = { identityId: creator, callerClass: "user", issuer: "", rawToken: "" };
  const made = await existingOutput(deps.store, id);
  if (made !== undefined) {
    // Written again: a registration that stopped between the row and its
    // access converges, and the writes are idempotent.
    await writeAccess(deps, made, caller);
    return made;
  }

  const blob = await deps.blobs.promote(org, uploadRef);
  const filename = outputFilename(outputPath);
  const file = create(FileSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "File",
    metadata: {
      id,
      org,
      name: fileNameOf(filename),
      visibility: ApiResourceVisibility.visibility_private,
    },
    spec: { filename, mimeType: fileMimeType(filename, "") },
    status: { sizeBytes: BigInt(blob.sizeBytes), sessionId, runId, outputPath },
  });
  setAuditFieldsForCreate(FileSchema, file, caller);

  try {
    await deps.blobs.insertFile(id, FileSchema, file, blob);
  } catch (error) {
    // Two registrations of one output at once: the other's File stands,
    // and this one's promoted bytes are left to the sweep.
    const other = await existingOutput(deps.store, id);
    if (other !== undefined) {
      await writeAccess(deps, other, caller);
      return other;
    }
    throw error;
  }
  if (sessionId !== "" && !(await sessionExists(deps.store, sessionId))) {
    // A conversation deleted while this File landed: its delete listed its
    // Files before this row, so the File is taken back here
    // (steps.ts PersistUploadedFile's rule).
    await deps.blobs.removeFile(id);
    throw notFoundError("session", sessionId);
  }
  await writeAccess(deps, file, caller);
  return file;
}

/** The File's access, as a create writes it: its owner, its organization, its conversation as parent. */
async function writeAccess(deps: OutputDeps, file: File, caller: CallerIdentity): Promise<void> {
  if (deps.lifecycle === undefined) {
    return;
  }
  const event = resolveResourceCreatedEvent(ApiResourceKind.file, file, caller, deps.logger);
  if (event !== undefined) {
    await deps.lifecycle.onResourceCreated(event);
  }
}

/** The File an earlier registration of this output made, or undefined. */
async function existingOutput(store: Store, id: string): Promise<File | undefined> {
  try {
    return await store.getResource(ApiResourceKind.file, id, FileSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw internalError(error, "failed to read the run's outputs");
  }
}

async function sessionExists(store: Store, sessionId: string): Promise<boolean> {
  try {
    await store.getResource(ApiResourceKind.session, sessionId, SessionSchema);
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return false;
    }
    throw internalError(error, "failed to load session");
  }
}
