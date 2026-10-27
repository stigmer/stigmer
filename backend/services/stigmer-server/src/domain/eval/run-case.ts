/**
 * RunEvalCaseController.getArchiveDownloadUrl: a runner asks, once per
 * eval-run try, for a link to the archive of the Eval version its run's
 * case names, signed for the runner's address (stigmer#2364).
 *
 * Why a door of its own. The public getDownloadUrl (controller.ts) signs
 * for a person, because a person's machine must resolve the link; a
 * runner may reach the store at another address (a sandbox on a local
 * stack, a self-host's private network), and whether a caller is a runner
 * cannot be told from who it is: a desktop runner presents its person's
 * own sign-in. So the runner asks here, and the link is signed for it.
 *
 * The gate. The method is skip-authorization because a permission cannot
 * tell a runner from the person it acts for; the authority is the runner
 * credential acting for this run (runnerauth/runner-for-run.ts, the
 * decision the File mount asks), and the run must not be finished. Every
 * refusal of the credential is the same PERMISSION_DENIED.
 *
 * What it answers. The run's own spec is the authority over what may be
 * fetched: its eval case names the Eval and the version, and no request
 * field can name another. No can_view is asked: the eval run that made
 * this run read the Eval when it planned the case, as the File mount asks
 * nothing of its conversation's Files. A run with no case, or a plugin's
 * case (fetched from the plugin's archive by its storage key), is refused.
 * A missing Eval, version or archive answers as getDownloadUrl answers it.
 *
 * Registered by run-eval-case.ts. Proven by __tests__/run-case.test.ts and
 * __tests__/download-links.test.ts.
 */
import type { HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import type { EvalArchiveDownloadUrl } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/io_pb";
import type { GetRunEvalCaseArchiveInput } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/run_eval_case_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import type { ContentAddressedArchiveStore } from "../../archive/content-store.js";
import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  permissionDeniedError,
} from "../../pipeline/errors.js";
import { parseBearerToken } from "../../pipeline/interceptors/auth.js";
import { loadByReferenceWithVersion } from "../../pipeline/steps/version-history.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import { isRunnerForRun } from "../../runnerauth/runner-for-run.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { isTerminalExecutionPhase } from "../run/phases.js";
import type { ArchiveStaging } from "../skill/transfer/staging.js";
import {
  EVAL_TRANSFER_LANE_NOT_CONFIGURED,
  RUN_EVAL_CASE_NOT_THE_RUNS_RUNNER,
  runEvalCaseFinishedMessage,
  runEvalCaseNoneMessage,
} from "./constants.js";
import { archiveDownloadUrl } from "./controller.js";
import { evalVersionBinding } from "./versions.js";

export interface RunEvalCaseDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly runnerAuth: RunnerCredentialProvider;
  /** The eval archives (`evals/<digest>.zip`), as the Eval's own lanes read them. */
  readonly artifactStorage: ContentAddressedArchiveStore;
  /** The staging port the Eval's lanes sign through; absent, the door answers FailedPrecondition. */
  readonly staging?: ArchiveStaging;
}

export async function getRunEvalCaseArchiveDownloadUrl(
  deps: RunEvalCaseDeps,
  input: GetRunEvalCaseArchiveInput,
  ctx: HandlerContext,
): Promise<EvalArchiveDownloadUrl> {
  if (input.runId === "") {
    throw invalidArgumentError("run_id is required");
  }
  const token = parseBearerToken(ctx.requestHeader.get("authorization") ?? "");
  if (token === "" || !(await isRunnerForRun(deps, token, input.runId))) {
    throw permissionDeniedError(RUN_EVAL_CASE_NOT_THE_RUNS_RUNNER);
  }

  const run = await loadRun(deps.store, input.runId);
  if (isTerminalExecutionPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)) {
    throw failedPreconditionError(runEvalCaseFinishedMessage(input.runId));
  }
  const evalCase = run.spec?.evalCase;
  if (evalCase === undefined || evalCase.evalId === "") {
    throw failedPreconditionError(runEvalCaseNoneMessage(input.runId, (evalCase?.pluginId ?? "") !== ""));
  }
  const staging = deps.staging;
  if (staging === undefined) {
    throw failedPreconditionError(EVAL_TRANSFER_LANE_NOT_CONFIGURED);
  }

  const version = await loadByReferenceWithVersion(
    deps.store,
    evalVersionBinding,
    create(ApiResourceReferenceSchema, {
      kind: ApiResourceKind.eval,
      id: evalCase.evalId,
      version: evalCase.evalDigest,
    }),
  );
  return archiveDownloadUrl(deps.artifactStorage, staging, version, "runner");
}

async function loadRun(store: Store, runId: string): Promise<Run> {
  try {
    return await store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw permissionDeniedError(RUN_EVAL_CASE_NOT_THE_RUNS_RUNNER);
    }
    throw internalError(error, "failed to load the run");
  }
}
