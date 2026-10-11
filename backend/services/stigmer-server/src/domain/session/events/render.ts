/**
 * A session event as Claude Managed Agents' JSON: the shape Anthropic's
 * SDK types (`BetaManagedAgentsSessionEvent`), with the event's `type`.
 *
 * The contract is modelled so this rendering is mechanical
 * (apis/ai/stigmer/agentic/session/v1/event.proto):
 *
 *   1. a Managed Agents string literal is a validated string field, so it
 *      renders as itself;
 *   2. a `type`-tagged union is one flat message holding only the active
 *      variant's fields, and protobuf JSON omits unset fields, so it
 *      renders as that variant;
 *   3. a required key whose value may be null (`stop_details`) is a proto3
 *      `optional` field, rendered `null` when unset. A key Managed Agents
 *      marks optional (`?:`) is a plain field, omitted when unset.
 *
 * Three things are done here, and nothing else: protobuf JSON with proto
 * field names, the type string from the oneof member's `event_type`
 * option (catalog.ts), and `null` for every unset `optional` field. The
 * envelope (seq, session, run, thread) is Stigmer's and is not part of the
 * event's JSON.
 *
 * Proven by __tests__/render.sdk-shapes.test.ts: one fixture per landed
 * event, typed against the pinned SDK's own types, deep-equal to what this
 * renders.
 */
import { isFieldSet, toJson } from "@bufbuild/protobuf";
import type { DescMessage, JsonObject, Message } from "@bufbuild/protobuf";

import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import {
  EventDeltaSchema,
  EventStartSchema,
  SessionEventSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { StreamSessionEventsResponse } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

import { eventTypeOf } from "./catalog.js";

/** An event's Managed Agents JSON. */
export function toManagedAgentsJson(event: SessionEvent): JsonObject {
  const schema = event.event.case === undefined ? undefined : MEMBER_SCHEMAS.get(event.event.case);
  if (schema === undefined || event.event.value === undefined) {
    throw new Error("a session event must hold an event");
  }
  return { ...messageJson(schema, event.event.value), type: eventTypeOf(event) };
}

/** A stream frame's Managed Agents JSON: the event, or an event_start / event_delta preview. */
export function toManagedAgentsStreamJson(frame: StreamSessionEventsResponse): JsonObject {
  switch (frame.frame.case) {
    case "event":
      return toManagedAgentsJson(frame.frame.value);
    case "eventStart":
      return { ...messageJson(EventStartSchema, frame.frame.value), type: "event_start" };
    case "eventDelta":
      return { ...messageJson(EventDeltaSchema, frame.frame.value), type: "event_delta" };
    case undefined:
      throw new Error("a stream frame must hold a frame");
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = frame.frame;
      throw new Error(`unknown stream frame ${String(exhaustive)}`);
    }
  }
}

const MEMBER_SCHEMAS = new Map<string, DescMessage>();
for (const member of SessionEventSchema.oneofs.find((o) => o.name === "event")?.fields ?? []) {
  if (member.message !== undefined) {
    MEMBER_SCHEMAS.set(member.localName, member.message);
  }
}

/** Protobuf JSON with proto field names, then `null` for every unset `optional` field, at every depth. */
function messageJson(schema: DescMessage, message: Message): JsonObject {
  const json = toJson(schema, message, { useProtoFieldName: true }) as JsonObject;
  fillNulls(schema, message, json);
  return json;
}

function fillNulls(schema: DescMessage, message: Message, json: JsonObject): void {
  for (const field of schema.fields) {
    const set = isFieldSet(message, field);
    if (!set) {
      if (field.proto.proto3Optional === true) {
        json[field.name] = null;
      }
      continue;
    }
    // Well-known types (Struct) render as plain JSON with no optional fields of ours.
    if (field.message === undefined || field.message.typeName.startsWith("google.protobuf.")) {
      continue;
    }
    const value = (message as unknown as Record<string, unknown>)[field.localName];
    const rendered = json[field.name];
    if (field.fieldKind === "message") {
      fillNulls(field.message, value as Message, rendered as JsonObject);
    } else if (field.fieldKind === "list" && Array.isArray(rendered)) {
      (value as Message[]).forEach((element, index) => {
        fillNulls(field.message!, element, rendered[index] as JsonObject);
      });
    }
  }
}
