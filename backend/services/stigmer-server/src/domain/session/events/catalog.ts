/**
 * The session event catalog: each event's Claude Managed Agents type
 * string, read once from the contract (the `event_type` option on every
 * oneof member of SessionEvent, apis/ai/stigmer/agentic/session/v1/
 * event.proto), and the sets the server's rules are written in.
 *
 * The type is declared in the proto and nowhere else, so this module maps
 * a oneof case to its option and never restates a type string beside it;
 * the sets below name events by type string because that is how the
 * outside format, the store and a list filter name them.
 *
 * Who writes what. The server writes the turn's user message, the
 * session's status and each turn's (`stigmer.run.status`,
 * domain/session/events/transitions.ts), every
 * file-review decision (`stigmer.file_review.decided`, with its ledger
 * event, run-writes.ts), every answer to a waiting tool use
 * (`user.tool_confirmation`, `stigmer.permission.grant`,
 * ../hitl/answer.ts) and the session's stop (`user.interrupt`,
 * ../hitl/interrupt.ts); a runner writes what the agent did, its threads,
 * the errors it sees first, and Stigmer's other events about the turn
 * (`RUNNER_EVENT_TYPES`, append.ts), the files a turn changed and the
 * undone files it put back among them, and where an offloaded tool
 * output is stored (`stigmer.tool_result.full_output`). The session's and
 * a turn's status have one writer, the server, so a runner may never send
 * a status event; nor a
 * decision or an answer, so a runner can never forge a person's keep,
 * undo, allow or deny.
 *
 * Proven by __tests__/catalog.test.ts.
 */
import { getOption } from "@bufbuild/protobuf";
import type { DescField } from "@bufbuild/protobuf";

import { event_type } from "@stigmer/protos/ai/stigmer/commons/apiresource/field_options_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

/** The id prefix of an event the server mints (`generateId`). */
export const SESSION_EVENT_ID_PREFIX = "sevt";

/** A SessionEvent oneof case that holds an event. */
export type SessionEventCase = NonNullable<SessionEvent["event"]["case"]>;

/** The events that describe the session itself; a run's removal keeps them (run-writes.ts). */
export const SESSION_STATUS_TYPES: ReadonlyArray<string> = [
  "session.status_running",
  "session.status_idle",
];

/**
 * The types a runner may append: what the agent did, its threads, errors,
 * and Stigmer's own events about the turn (the stigmer.* types, which no
 * Managed Agents client needs), all but `stigmer.file_review.decided`,
 * `stigmer.permission.grant` and `stigmer.run.status`, which are the
 * server's.
 */
export const RUNNER_EVENT_TYPES: ReadonlySet<string> = new Set([
  "agent.message",
  "agent.thinking",
  "agent.tool_use",
  "agent.tool_result",
  "agent.mcp_tool_use",
  "agent.mcp_tool_result",
  "agent.thread_message_sent",
  "agent.thread_message_received",
  "agent.thread_context_compacted",
  "session.thread_created",
  "session.thread_status_running",
  "session.thread_status_idle",
  "session.error",
  "stigmer.agent.thinking",
  "stigmer.permission.asked",
  "stigmer.harness.note",
  "stigmer.agent.structured_output",
  "stigmer.memory.recalled",
  "stigmer.file_review.changes",
  "stigmer.file_review.reconciled",
  "stigmer.tool_result.full_output",
]);

const typeByCase = new Map<string, string>();
const caseByType = new Map<string, SessionEventCase>();
for (const member of SessionEventSchema.oneofs.find((o) => o.name === "event")?.fields ?? []) {
  const type = typeOfMember(member);
  typeByCase.set(member.localName, type);
  caseByType.set(type, member.localName as SessionEventCase);
}

function typeOfMember(member: DescField): string {
  const type = getOption(member, event_type);
  /* v8 ignore next -- @preserve: every member of the contract declares one (the catalog test pins each type); a member added without it fails here at module load */
  if (type === "") {
    throw new Error(`SessionEvent member '${member.name}' declares no event_type`);
  }
  return type;
}

/** Every event type the contract lands, in declaration order. */
export const SESSION_EVENT_TYPES: ReadonlyArray<string> = [...caseByType.keys()];

/** The prefix of Stigmer's own event types, which are not Managed Agents types. */
export const STIGMER_EVENT_TYPE_PREFIX = "stigmer.";

/** Whether a type is Stigmer's own (stigmer.*) rather than a Managed Agents type. */
export function isStigmerEventType(type: string): boolean {
  return type.startsWith(STIGMER_EVENT_TYPE_PREFIX);
}

/** An event's Managed Agents type string; throws for an event that holds none. */
export function eventTypeOf(event: SessionEvent): string {
  const type = event.event.case === undefined ? undefined : typeByCase.get(event.event.case);
  if (type === undefined) {
    throw new Error("a session event must hold an event");
  }
  return type;
}

/** The oneof case for a type string; undefined for a type the contract does not land. */
export function eventCaseOf(type: string): SessionEventCase | undefined {
  return caseByType.get(type);
}

/** The event's own id ("" when it holds no event). */
export function eventIdOf(event: SessionEvent): string {
  return event.event.case === undefined ? "" : event.event.value.id;
}
