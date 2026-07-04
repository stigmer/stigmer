// Identity of the session's plan tab in the workspace surface's editor group.
//
// Kept in its own module (not in PlanEditor.tsx) so behavior-only consumers —
// useSessionPanel opens the tab, SessionViewer routes to it — depend on the
// identity without pulling the component (and its markdown renderer) into
// their module graph (DD-003 headless-first).

import { virtualEntryId } from "../internal/store/index.js";
import { PLAN_ARTIFACT_NAME } from "../library/detect-plan-artifact.js";

/**
 * Virtual entry id of the plan document tab. One tab per session — the host
 * swaps WHICH plan the tab shows (latest editable, or a superseded plan
 * read-only); the tab itself never multiplies.
 */
export const PLAN_DOCUMENT_ENTRY_ID = virtualEntryId("plan");

/** The plan tab's path — doubles as its tab label, matching the artifact name. */
export const PLAN_DOCUMENT_PATH = PLAN_ARTIFACT_NAME;
