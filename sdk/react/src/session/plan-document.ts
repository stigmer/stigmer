// Identity of the session's plan tab in the workspace surface's editor group.
//
// Kept in its own module (not in PlanEditor.tsx) so behavior-only consumers —
// useSessionPanel opens the tab, SessionViewer routes to it — depend on the
// identity without pulling the component (and its markdown renderer) into
// their module graph (DD-003 headless-first).

import { virtualEntryId } from "../internal/store/index.js";

/**
 * Virtual entry id of the plan document tab. One tab per session — the host
 * swaps WHICH plan the tab shows (latest editable, or a superseded plan
 * read-only); the tab itself never multiplies.
 */
export const PLAN_DOCUMENT_ENTRY_ID = virtualEntryId("plan");

/**
 * The plan tab's path — doubles as its tab label.
 *
 * Deliberately plan-AGNOSTIC ("Plan"), not the artifact's filename. The
 * workspace surface identifies a virtual document's tab by
 * `editorKey(entryId, path)`, so `path` is part of the tab's IDENTITY — and the
 * session keeps exactly ONE plan tab that swaps which plan it shows (latest
 * editable, or a superseded plan read-only). Now that plans carry unique,
 * title-derived filenames (`<slug>_<id>.plan.md`), binding this label to any one
 * plan's name would mint a new tab identity per plan and shatter the
 * single-tab design. A stable, generic label is therefore required, not a
 * stylistic choice — do not "fix" it to track the filename.
 */
export const PLAN_DOCUMENT_PATH = "Plan";
