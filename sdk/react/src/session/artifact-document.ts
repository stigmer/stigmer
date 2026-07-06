// Identity of the session's artifact document tabs in the workspace surface's
// editor group.
//
// Kept in its own module (not in ArtifactDocument.tsx) so behavior-only
// consumers — useSessionPanel opens an artifact tab, SessionViewer routes to it
// — depend on the identity without pulling the component (and its content
// renderer) into their module graph (DD-003 headless-first). Mirrors
// plan-document.ts.

import { virtualEntryId } from "../internal/store/index.js";

/**
 * Virtual entry id of the artifact document FAMILY. Unlike the plan (one tab
 * per session), artifacts are many: every opened artifact shares this one
 * entry id and is distinguished by its {@link artifactKey}-derived `path`, so
 * `editorKey(ARTIFACT_DOCUMENT_ENTRY_ID, path)` yields one tab per artifact —
 * the VS Code "each file is a tab" model. The NUL-namespaced virtual id can
 * never alias a real workspace entry, and its distinct `"artifact"` kind can
 * never collide with the plan tab's `"plan"` kind.
 *
 * @see artifactKey — the `path` component (an artifact's stable identity)
 */
export const ARTIFACT_DOCUMENT_ENTRY_ID = virtualEntryId("artifact");
