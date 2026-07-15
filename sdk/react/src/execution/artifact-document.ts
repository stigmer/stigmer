// Identity of artifact document tabs in the workspace surface's editor group.
// Domain: execution (shared — both the session and workflow panels open
// artifact tabs, and a single identity source prevents the two viewers from
// minting divergent virtual ids for the same tab family).
//
// Kept in its own module (not in a component file) so behavior-only
// consumers — the session/workflow panel controllers open artifact tabs, the
// viewers route to them — depend on the identity without pulling a component
// (and its content renderer) into their module graph (DD-003 headless-first).
// Mirrors session/plan-document.ts.

import { virtualEntryId } from "../internal/store/index.js";

/**
 * Virtual entry id of the artifact document FAMILY. Unlike the plan (one tab
 * per session), artifacts are many: every opened artifact shares this one
 * entry id and is distinguished by its identity-derived `path` (the session's
 * `artifactKey`, the workflow's `Artifact` id), so
 * `editorKey(ARTIFACT_DOCUMENT_ENTRY_ID, path)` yields one tab per artifact —
 * the VS Code "each file is a tab" model. The NUL-namespaced virtual id can
 * never alias a real workspace entry, and its distinct `"artifact"` kind can
 * never collide with the plan tab's `"plan"` kind.
 */
export const ARTIFACT_DOCUMENT_ENTRY_ID = virtualEntryId("artifact");
