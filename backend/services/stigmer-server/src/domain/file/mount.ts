/**
 * FileMountController.mount: a runner asks, once per turn, for the Files
 * its run's conversation holds, each with where the agent finds it under
 * .stigmer/uploads/ and a link to its bytes signed for the runner, valid
 * for an hour.
 *
 * The gate. The method is skip-authorization because a permission cannot
 * tell a runner from the person it acts for; the authority is the runner
 * credential acting for this run (runnerauth/runner-for-run.ts, the
 * decision the session log's append asks), and the run must not be
 * finished. Every refusal of the credential is the same PERMISSION_DENIED.
 *
 * What it answers. The conversation's file resources, in their order, each
 * only while the File is still the conversation's own: one deleted since,
 * or of another conversation or organization, is left out. The
 * conversation's own copy was made when the File was named, so the
 * original's later access says nothing here; who may read a link is the
 * runner that asked.
 *
 * A service of its own beside the File's commands and queries: the one
 * surface that answers capability links to a runner is this file.
 *
 * Proven by __tests__/mount.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileMountController, FileMountSchema, RunFileMountsSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/mount_pb";
import type { FileMount, MountRunFilesInput, RunFileMounts } from "@stigmer/apis/ai/stigmer/agentic/file/v1/mount_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  permissionDeniedError,
} from "../../pipeline/errors.js";
import { parseBearerToken } from "../../pipeline/interceptors/auth.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import { isRunnerForRun } from "../../runnerauth/runner-for-run.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { isTerminalExecutionPhase } from "../run/phases.js";
import type { FileBlobs } from "./blobs.js";

/** The one refusal every caller outside the gate gets, whatever the reason. */
export const NOT_THE_RUNS_RUNNER_MOUNT_MESSAGE = "only the runner acting for this run may mount its files";

export interface FileMountDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly runnerAuth: RunnerCredentialProvider;
  readonly blobs: FileBlobs;
}

/** Registers the runner's File mount service (routes stage). */
export function registerFileMountService(router: ConnectRouter, deps: FileMountDeps): void {
  router.service(FileMountController, {
    mount: (input, ctx) => mountRunFiles(deps, input, ctx),
  });
}

export async function mountRunFiles(
  deps: FileMountDeps,
  input: MountRunFilesInput,
  ctx: HandlerContext,
): Promise<RunFileMounts> {
  if (input.runId === "") {
    throw invalidArgumentError("run_id is required");
  }
  const token = parseBearerToken(ctx.requestHeader.get("authorization") ?? "");
  if (token === "" || !(await isRunnerForRun(deps, token, input.runId))) {
    throw permissionDeniedError(NOT_THE_RUNS_RUNNER_MOUNT_MESSAGE);
  }

  const run = await loadRun(deps.store, input.runId);
  if (isTerminalExecutionPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)) {
    throw failedPreconditionError(`run '${input.runId}' is finished; it mounts no files`);
  }
  const target = run.spec?.target;
  const sessionId = target?.case === "sessionId" ? target.value : "";
  if (sessionId === "") {
    return create(RunFileMountsSchema);
  }
  const org = run.metadata?.org ?? "";
  let resources;
  try {
    resources = (await deps.store.getResource(ApiResourceKind.session, sessionId, SessionSchema)).spec?.resources ?? [];
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw failedPreconditionError(`run '${input.runId}' names a conversation that is gone`);
    }
    throw internalError(error, "failed to load the run's conversation");
  }

  const entries: FileMount[] = [];
  for (const entry of resources) {
    if (entry.resource.case !== "file") {
      continue;
    }
    const { fileId, mountPath } = entry.resource.value;
    let file;
    try {
      file = await deps.store.getResource(ApiResourceKind.file, fileId, FileSchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        continue;
      }
      throw internalError(error, "failed to load a file of the conversation");
    }
    if ((file.status?.sessionId ?? "") !== sessionId || (file.metadata?.org ?? "") !== org) {
      continue;
    }
    const url = await deps.blobs.mountUrl(fileId);
    if (url === undefined) {
      continue;
    }
    entries.push(
      create(FileMountSchema, {
        fileId,
        mountPath,
        filename: file.spec?.filename ?? "",
        mimeType: file.spec?.mimeType ?? "",
        sizeBytes: file.status?.sizeBytes ?? 0n,
        url,
      }),
    );
  }
  return create(RunFileMountsSchema, { entries });
}

async function loadRun(store: Store, runId: string): Promise<Run> {
  try {
    return await store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw permissionDeniedError(NOT_THE_RUNS_RUNNER_MOUNT_MESSAGE);
    }
    throw internalError(error, "failed to load the run");
  }
}
