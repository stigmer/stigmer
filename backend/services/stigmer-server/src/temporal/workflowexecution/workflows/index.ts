/**
 * Workflow barrel — the entry point for Temporal's workflow bundler
 * (the agentexecution barrel's twin; runner precedent).
 *
 * The Temporal TS SDK derives the workflow TYPE from the export name of
 * the module passed to workflowsPath; the ES2022 arbitrary module export
 * name maps the TypeScript function to the slash-delimited, byte-pinned
 * workflow type the engine client starts
 * ("stigmer/workflow-execution/invoke", names.ts).
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: everything reachable from this
 * module runs in the deterministic sandbox — no node built-ins, no
 * store/transport imports (see invoke-workflow-execution.ts's header).
 */
export { invokeWorkflowExecution as "stigmer/workflow-execution/invoke" } from "./invoke-workflow-execution.js";
