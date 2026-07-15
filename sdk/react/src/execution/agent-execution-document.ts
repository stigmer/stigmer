// Identity of agent-execution transcript tabs in the workspace surface's
// editor group. Domain: execution (the transcript renderer and the
// AgentExecution data model are execution-domain; the workflow panel is the
// first host, and a future session-side consumer — e.g. sub-agent expansion —
// would share this identity rather than minting a divergent one).
//
// Kept in its own module (not in a component file) so behavior-only
// consumers — the panel controller opens the tabs, the viewer routes them —
// depend on the identity without pulling the transcript renderer into their
// module graph (DD-003 headless-first). Mirrors artifact-document.ts and
// file-change-document.ts.

import { virtualEntryId } from "../internal/store/index.js";

/**
 * Virtual entry id of the agent-execution transcript document FAMILY. Like
 * artifacts and file changes (and unlike the session's single plan tab),
 * transcripts are many: every opened child AgentExecution shares this one
 * entry id and is distinguished by its id-derived tab path, so
 * `editorKey(AGENT_EXECUTION_DOCUMENT_ENTRY_ID, path)` yields one tab per
 * child execution — the VS Code "each file is a tab" model. The
 * NUL-namespaced virtual id can never alias a real workspace entry, and its
 * distinct `"agentexec"` kind can never collide with the
 * `"artifact"`/`"filechange"`/`"plan"` families.
 */
export const AGENT_EXECUTION_DOCUMENT_ENTRY_ID = virtualEntryId("agentexec");

/**
 * The identity of a child AgentExecution's transcript tab within the family.
 *
 * The path deliberately CARRIES the child execution id (unlike artifact tabs,
 * which need an owner-level record map to resolve content): a transcript
 * needs only the id to fetch/stream itself, so the viewer parses it straight
 * back out with {@link parseAgentExecutionTabPath} — no lookup map to keep in
 * sync. The suffix is the AGENT_CALL task name because the editor tab's LABEL
 * is the path's basename: the task name correlates the tab with the DAG node
 * the user opened it from, and keeps two calls to the same agent distinct.
 */
export function agentExecutionTabPath(
  childExecutionId: string,
  taskName: string,
): string {
  return `${childExecutionId}/${taskName}`;
}

/**
 * Recovers the child execution id from a transcript tab's path — the inverse
 * of {@link agentExecutionTabPath}. Splits on the FIRST separator: execution
 * ids never contain `/`, so a task name that does still round-trips.
 */
export function parseAgentExecutionTabPath(path: string): string {
  const separator = path.indexOf("/");
  return separator === -1 ? path : path.slice(0, separator);
}
