/**
 * Workflow barrel — the entry point for Temporal's workflow bundler (the
 * agentexecution precedent). ES2022 arbitrary module export names map the
 * TypeScript function to the slash-delimited, byte-pinned workflow type
 * the artifact's baked action starts ("schedule/tick", ../names.ts).
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: everything reachable from this module
 * runs in the deterministic sandbox — no node built-ins, no
 * store/transport imports (see tick.ts's header).
 */
export { tick as "schedule/tick" } from "./tick.js";
