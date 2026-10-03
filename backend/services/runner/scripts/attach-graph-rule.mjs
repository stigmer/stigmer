/**
 * The one rule for what the attach entry may not load: any module of
 * `@temporalio`, the runner's entry, its runner, manager and worker
 * modules, or anything under its harness and activities folders. A sandbox
 * snapshot holds the attach waiter, so it must stay a small idle process
 * (src/attach/waiter.ts says why). Two checks apply the rule to two shapes
 * of the entry: scripts/verify-attach-boot.mjs to the compiled dist's
 * module URLs, and scripts/bundle-slim.mjs to the slim bundle's esbuild
 * inputs (paths relative to this package). The source-level twin is
 * src/attach/__tests__/import-graph.test.ts. The repository root's
 * scripts/attach-graph-rule.test.mjs pins the rule on both shapes, the
 * modules it refuses and the ones it allows.
 */

const FORBIDDEN =
  /@temporalio|(^|\/)dist\/(main|runner|runner-manager|worker)\.js$|(^|\/)dist\/(harness|activities)\//;

/** The modules of `loaded` (URLs or paths) the attach entry must not load. */
export function forbiddenAttachModules(loaded) {
  return loaded.filter((module) =>
    FORBIDDEN.test(module.replaceAll("\\", "/")),
  );
}
