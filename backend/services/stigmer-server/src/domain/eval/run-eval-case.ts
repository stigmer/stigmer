/**
 * RunEvalCaseController: a runner's door to the eval case its run tries.
 * getArchiveDownloadUrl (run-case.ts) hands an eval-run try a link to the
 * archive of the Eval version its run's case names, signed for the
 * runner's address. One service, apart from the Eval's queries, so the
 * one surface that answers a runner an Eval's archive is this handler
 * behind one gate (runnerauth/runner-for-run.ts), as run-files.ts is the
 * File's.
 *
 * Proven by __tests__/run-case.test.ts, through this registration as
 * through its handler.
 */
import type { ConnectRouter } from "@connectrpc/connect";

import { RunEvalCaseController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/run_eval_case_pb";

import { getRunEvalCaseArchiveDownloadUrl } from "./run-case.js";
import type { RunEvalCaseDeps } from "./run-case.js";

/** Registers the runner's eval-case service (routes stage). */
export function registerRunEvalCaseService(router: ConnectRouter, deps: RunEvalCaseDeps): void {
  router.service(RunEvalCaseController, {
    getArchiveDownloadUrl: (input, ctx) => getRunEvalCaseArchiveDownloadUrl(deps, input, ctx),
  });
}
