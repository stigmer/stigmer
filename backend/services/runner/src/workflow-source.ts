/**
 * Resolves where the Temporal *workflow* code comes from.
 *
 * Workflow code (src/workflows/) runs inside Temporal's deterministic
 * sandbox, so it must be bundled separately from the activity/host code.
 * That bundle can be produced at two different times:
 *
 * 1. **Pre-built** — `scripts/bundle-slim.mjs` runs Temporal's bundler at
 *    build time and emits `workflow-bundle.js` next to the entry point.
 *    The slim embedding artifact ships WITHOUT webpack/@swc (they account
 *    for ~45 MB of node_modules), so runtime bundling is impossible there;
 *    the pre-built file is authoritative whenever it exists. The OTel
 *    workflow interceptor is baked in at build time and stays inert unless
 *    the host configures the OTel sink.
 *
 * 2. **Runtime** — dev loops (`tsx`, plain `tsc` dist) and tests fall back
 *    to Temporal's on-boot webpack bundling, exactly as before the slim
 *    artifact existed.
 *
 * `STIGMER_WORKFLOW_BUNDLE` overrides discovery with an explicit path —
 * useful for tests and for embedders that stage the bundle elsewhere.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type WorkflowSource =
  | {
      /** Pre-built bundle on disk; interceptors are already baked in. */
      readonly kind: "prebuilt";
      readonly codePath: string;
    }
  | {
      /** Bundle on boot from the compiled workflows entry module. */
      readonly kind: "runtime";
      readonly workflowsPath: string;
    };

/**
 * Module specifier of the OTel workflow interceptor. Exported so the build
 * script and the runtime fallback agree on what gets baked into / registered
 * with the workflow bundle.
 */
export const OTEL_WORKFLOW_INTERCEPTOR_MODULE =
  "@temporalio/interceptors-opentelemetry/lib/workflow-interceptors";

export function resolveWorkflowSource(): WorkflowSource {
  const explicit = process.env.STIGMER_WORKFLOW_BUNDLE;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(
        `STIGMER_WORKFLOW_BUNDLE points to a non-existent file: ${explicit}`,
      );
    }
    return { kind: "prebuilt", codePath: explicit };
  }

  // In the slim artifact every src/ module collapses into the single bundled
  // entry, so import.meta.url resolves next to main.js — exactly where the
  // build script emits workflow-bundle.js. In the tsc dist this resolves to
  // dist/workflow-bundle.js, which never exists (the build script writes only
  // into dist-slim/), so dev builds always take the runtime path.
  const sibling = new URL("./workflow-bundle.js", import.meta.url);
  if (existsSync(fileURLToPath(sibling))) {
    return { kind: "prebuilt", codePath: fileURLToPath(sibling) };
  }

  return {
    kind: "runtime",
    workflowsPath: fileURLToPath(new URL("./workflows/index.js", import.meta.url)),
  };
}
