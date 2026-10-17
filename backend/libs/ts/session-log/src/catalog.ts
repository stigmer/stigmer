/**
 * The session event catalog: each event's Claude Managed Agents type
 * string, read once from the contract (the `event_type` option on every
 * oneof member of SessionEvent, apis/ai/stigmer/agentic/session/v1/
 * event.proto).
 *
 * The type is declared in the proto and nowhere else, so this module maps
 * a oneof case to its option and never restates a type string beside it.
 * Who may write which type is the server's rule and lives there
 * (backend/services/stigmer-server/src/domain/session/events/catalog.ts).
 *
 * Proven by __tests__/catalog.test.ts.
 */
import { getOption } from "@bufbuild/protobuf";
import type { DescField } from "@bufbuild/protobuf";

import { event_type } from "@stigmer/apis/ai/stigmer/commons/apiresource/field_options_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

/** A SessionEvent oneof case that holds an event. */
export type SessionEventCase = NonNullable<SessionEvent["event"]["case"]>;

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

/** The event's processed_at ("" when it holds no event). */
export function processedAtOf(event: SessionEvent): string {
  return event.event.case === undefined ? "" : event.event.value.processedAt;
}
