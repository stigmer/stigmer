/**
 * Workflow barrel file — the entry point for Temporal's workflow bundler,
 * and the complete list of workflow types a runner registers.
 *
 * Re-exports workflow functions with the exact Temporal workflow type
 * names that the server uses to start them. The Temporal TS SDK derives
 * the workflow type from the export name of the module passed to
 * `workflowsPath`, so every export here is a registered type on every
 * worker root: the static worker, the manager and pool workers, and the
 * pre-built bundle (`scripts/bundle-slim.mjs`).
 *
 * THE RULE: every export is a type the server starts, and each takes ids
 * that the runner reads back from the server. Anyone who can reach Temporal
 * can start any type registered here on a runner's queue, so a new export
 * is a new door and is reviewed as a wire change. `__tests__/barrel.test.ts`
 * pins the exact set.
 *
 * The types and their starters:
 *   - "stigmer/mcp-server/connect" and "stigmer/mcp-server/discover": the
 *     server's plugin tools listing (`temporal/plugintools/names.ts` in the
 *     server), by plugin id and server name.
 *
 * ES2022 arbitrary module export names (`export { fn as "..." }`) let
 * us map TypeScript function names to the slash-delimited Temporal
 * workflow type names that the backend expects.
 *
 * Workflow interceptors are registered at bundle time — not imported
 * here: OTel's, inert unless the host configures the sink. Pre-built
 * bundles (scripts/bundle-slim.mjs) bake it in; the runtime-bundling
 * fallback passes it to the bundler (see src/workflow-source.ts).
 */

export {
  listPluginTools as "stigmer/mcp-server/connect",
  listPluginToolsLegacy as "stigmer/mcp-server/discover",
} from "./list-plugin-tools.js";
