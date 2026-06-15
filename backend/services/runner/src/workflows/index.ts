/**
 * Workflow barrel file — the entry point for Temporal's workflow bundler.
 *
 * Re-exports workflow functions with the exact Temporal workflow type
 * names that the Java/Go backend uses to start them. The Temporal TS
 * SDK derives the workflow type from the export name of the module
 * passed to `workflowsPath`.
 *
 * The Java backend starts workflows via:
 *   workflowClient.newUntypedWorkflowStub("stigmer/mcp-server/connect", ...)
 *
 * ES2022 arbitrary module export names (`export { fn as "..." }`) let
 * us map TypeScript function names to the slash-delimited Temporal
 * workflow type names that the backend expects.
 *
 * OTel workflow interceptors are registered at bundle time — not
 * imported here. Pre-built bundles (scripts/bundle-slim.mjs) bake them
 * in; the runtime-bundling fallback passes them to the bundler (see
 * src/workflow-source.ts).
 */

export {
  connectMcpServer as "stigmer/mcp-server/connect",
  discoverMcpServerLegacy as "stigmer/mcp-server/discover",
} from "./connect-mcp-server.js";

export {
  executeServerlessWorkflow as "stigmer/workflow/execute",
} from "./execute-serverless-workflow.js";

export {
  executeFromExecution as "stigmer/workflow/execute-from-execution",
} from "./execute-from-execution.js";
