// Identity of the AI-diagnosis document tab in the workflow execution
// panel's editor group. Domain: workflow — diagnosis (`WorkflowRepairCard` /
// the Workflow Architect flow) is workflow-only, so unlike the shared
// transcript/artifact/file-change families in execution/, this identity has
// no session-side consumer and lives beside its host.
//
// Kept in its own module (not in WorkflowRepairCard.tsx) so behavior-only
// consumers — useWorkflowExecutionPanel opens the tab, the viewer routes to
// it — depend on the identity without pulling the component (and its
// MessageThread/diff-graph subtree) into their module graph (DD-003
// headless-first). Mirrors session/plan-document.ts, the other singleton.

import { virtualEntryId } from "../internal/store/index.js";

/**
 * Virtual entry id of the diagnosis document tab. A SINGLETON, like the
 * session's plan tab (and unlike the artifact/file-change/transcript
 * families): one execution has one diagnosis conversation, and re-invoking
 * Diagnose focuses the existing tab rather than minting another. The
 * NUL-namespaced virtual id can never alias a real workspace entry, and its
 * distinct `"diagnosis"` kind can never collide with the other families.
 */
export const DIAGNOSIS_DOCUMENT_ENTRY_ID = virtualEntryId("diagnosis");

/**
 * The diagnosis tab's path — doubles as its tab label. A stable, generic
 * label is part of the singleton design: `editorKey(entryId, path)` is the
 * tab's IDENTITY, so a per-run label would mint a new tab per invocation
 * and shatter the open-or-focus semantics of `openDiagnosis`.
 */
export const DIAGNOSIS_DOCUMENT_PATH = "AI Diagnosis";
