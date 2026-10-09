/**
 * Workflow barrel: the entry point for Temporal's workflow bundler (the
 * schedule precedent). The arbitrary module export name maps the function
 * to the slash-delimited, byte-pinned workflow type (../names.ts).
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: everything reachable from this module
 * runs in the deterministic sandbox (see grade-run.ts's header).
 */
export { gradeRun as "stigmer/grading/grade-run" } from "./grade-run.js";
