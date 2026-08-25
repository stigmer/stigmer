/**
 * Workflow barrel — the entry point for Temporal's workflow bundler
 * (runner precedent: backend/services/runner/src/workflows/index.ts).
 *
 * The Temporal TS SDK derives the workflow TYPE from the export name of
 * the module passed to workflowsPath; ES2022 arbitrary module export
 * names map the TypeScript function to the slash-delimited, byte-pinned
 * workflow type the engine client starts
 * ("stigmer/agent-execution/invoke", names.ts).
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: everything reachable from this
 * module runs in the deterministic sandbox — no node built-ins, no
 * store/transport imports (see invoke-agent-execution.ts's header).
 */
export { invokeAgentExecution as "stigmer/agent-execution/invoke" } from "./invoke-agent-execution.js";
