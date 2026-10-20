/**
 * RunFileController: a runner's one door to Files. mount (mount.ts) hands
 * a turn the Files its conversation holds; createOutputUploads and
 * registerOutputs (outputs.ts) take back what the agent saved in its
 * outputs folder as Files of that conversation. One service, apart from
 * the File's commands and queries, so the one surface that answers
 * capability links to a runner, or takes a runner's file, is this folder's
 * two handlers behind one gate (runnerauth/runner-for-run.ts).
 *
 * Proven by __tests__/mount.test.ts and __tests__/outputs.test.ts, each
 * through this registration as through its handler.
 */
import type { ConnectRouter } from "@connectrpc/connect";

import { RunFileController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";

import { mountRunFiles } from "./mount.js";
import type { FileMountDeps } from "./mount.js";
import { createOutputUploads, registerOutputs } from "./outputs.js";
import type { OutputDeps } from "./outputs.js";

export type RunFileDeps = FileMountDeps & OutputDeps;

/** Registers the runner's File service (routes stage). */
export function registerRunFileService(router: ConnectRouter, deps: RunFileDeps): void {
  router.service(RunFileController, {
    mount: (input, ctx) => mountRunFiles(deps, input, ctx),
    createOutputUploads: (input, ctx) => createOutputUploads(deps, input, ctx),
    registerOutputs: (input, ctx) => registerOutputs(deps, input, ctx),
  });
}
