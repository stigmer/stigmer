/**
 * Resolves where a worker's Temporal WORKFLOW code comes from — the
 * runner's resolveWorkflowSource seam (runner src/workflow-source.ts),
 * generalized for a server that hosts one workflow entry per domain
 * worker.
 *
 * Workflow code runs inside Temporal's deterministic sandbox and must be
 * bundled separately from host code. Two production modes:
 *
 * 1. **Runtime** (this sub-project's operative mode, ratified brief #7 of
 *    sub-project 20260824.03): the worker bundles the compiled dist entry
 *    on boot via the SDK's built-in webpack. This is how conformance and
 *    the CLI-launched dev server boot — node_modules present, no native
 *    packaging needed.
 * 2. **Prebuilt** (the hook #24 cli-cutover fills): the slim artifact
 *    cannot bundle at runtime (no webpack/@swc shipped), so the build
 *    emits the bundle next to main.js and this resolver finds it as a
 *    sibling — exactly the runner's discovery rule.
 *
 * Callers pass URLs relative to their own module (import.meta.url): in the
 * tsc dist the sibling bundle never exists so dev builds always take the
 * runtime path; in a slim artifact every module collapses into main.js and
 * the sibling resolves next to it, where #24's build will emit it.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type WorkflowSource =
  | {
      /** Pre-built bundle on disk (slim artifacts; #24). */
      readonly kind: "prebuilt";
      readonly codePath: string;
    }
  | {
      /** Bundle on boot from the compiled workflows entry module. */
      readonly kind: "runtime";
      readonly workflowsPath: string;
    };

export interface ResolveWorkflowSourceOptions {
  /**
   * Candidate workflows entries in preference order — typically the
   * compiled `.js` first, then the `.ts` source (the tsx dev loop runs
   * from src/, where only the .ts exists; the SDK's bundler compiles
   * TypeScript natively, so either candidate works).
   */
  readonly workflowsEntryCandidates: readonly URL[];
  /** Where a prebuilt bundle would sit (e.g. new URL("./workflow-bundle-agent-execution.js", import.meta.url)). */
  readonly prebuiltSibling: URL;
}

export function resolveWorkflowSource(
  options: ResolveWorkflowSourceOptions,
): WorkflowSource {
  const prebuiltPath = fileURLToPath(options.prebuiltSibling);
  if (existsSync(prebuiltPath)) {
    return { kind: "prebuilt", codePath: prebuiltPath };
  }
  for (const candidate of options.workflowsEntryCandidates) {
    const candidatePath = fileURLToPath(candidate);
    if (existsSync(candidatePath)) {
      return { kind: "runtime", workflowsPath: candidatePath };
    }
  }
  throw new Error(
    "no Temporal workflows entry found (checked: " +
      options.workflowsEntryCandidates
        .map((url) => fileURLToPath(url))
        .join(", ") +
      ") — the build did not emit the workflows module",
  );
}
