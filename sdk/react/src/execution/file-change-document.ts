// Identity of file-change diff document tabs in the workspace surface's
// editor group. Domain: execution (the diff renderer and the FileChange data
// model are execution-domain; the workflow panel is the first host, and a
// future session-side consumer would share this identity rather than minting
// a divergent one).
//
// Kept in its own module (not in a component file) so behavior-only
// consumers — the panel controller opens the tabs, the viewer routes them —
// depend on the identity without pulling the diff renderer into their module
// graph (DD-003 headless-first). Mirrors artifact-document.ts.

import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { virtualEntryId } from "../internal/store/index.js";

/**
 * Virtual entry id of the file-change diff document FAMILY. Like artifacts
 * (and unlike the session's single plan tab), file changes are many: every
 * opened diff shares this one entry id and is distinguished by its
 * change-path-derived tab path, so
 * `editorKey(FILE_CHANGE_DOCUMENT_ENTRY_ID, path)` yields one tab per changed
 * file — the VS Code "each file is a tab" model. The NUL-namespaced virtual
 * id can never alias a real workspace entry, and its distinct `"filechange"`
 * kind can never collide with the `"artifact"`/`"plan"` families.
 */
export const FILE_CHANGE_DOCUMENT_ENTRY_ID = virtualEntryId("filechange");

/**
 * The identity of a file change's diff tab within the family. The net rollup
 * carries at most one {@link FileChange} per path, so the change's path IS
 * the identity — and, as the tab path, its basename is exactly the tab label
 * (no prefixing needed, unlike artifact tabs whose ids are opaque).
 * `absolutePath` is the fallback for captures without a workspace-relative
 * path, matching the keying inside the net-collapse core.
 */
export function fileChangeTabPath(change: FileChange): string {
  return change.path || change.absolutePath;
}
