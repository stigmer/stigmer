/**
 * The server's twin of the runner's session event ids
 * (backend/services/runner/src/harness/events/ids.ts): the id of the tool
 * use a call row wrote, and the run a tool use belongs to. An answer names
 * a tool use; the server finds the row it answers by deriving each asked
 * row's id the runner's way, so the two must never drift. The shared
 * corpus `apis/testdata/session-events/ids/vectors.json` pins both
 * (__tests__/ids-corpus.test.ts here, the runner's ids-corpus test there).
 *
 * A tool use id is `<run>.<call id>` when the call id fits the contract's
 * id pattern with room for the longest suffix, else `<run>.h<the first 32
 * hex digits of the call id's SHA-256>`. Run ids are server-minted and
 * hold no `.`, so the text before the first `.` is the run.
 */
import { createHash } from "node:crypto";

/** The contract's event id pattern (`event.proto`). */
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** The longest suffix the runner appends to a tool use id, with room. */
const SUFFIX_ROOM = 16;

/** The runner's root scope word, never a call id as written. */
const ROOT_SCOPE = "root";

/** The `agent.tool_use` (or `agent.mcp_tool_use`) id of a call row. */
export function toolUseEventId(runId: string, callId: string): string {
  const candidate = `${runId}.${callId}`;
  if (
    callId !== ROOT_SCOPE &&
    callId !== "" &&
    EVENT_ID_PATTERN.test(candidate) &&
    candidate.length + SUFFIX_ROOM <= 128
  ) {
    return candidate;
  }
  return `${runId}.h${createHash("sha256").update(callId).digest("hex").slice(0, 32)}`;
}

/** The run a tool use id belongs to; "" when it names none. */
export function runIdOfToolUse(toolUseId: string): string {
  const dot = toolUseId.indexOf(".");
  return dot <= 0 ? "" : toolUseId.slice(0, dot);
}
