/**
 * `POST /v1/sessions/{id}/events`: a person's events sent to a session,
 * `{events:[…]}` in, `{data:[…the recorded events]}` out.
 *
 * Three events are served, each through the native method that owns it,
 * so each meets that method's own authorization and the composed guards:
 *
 *   - user.message (text blocks only) starts a turn: RunCommandController
 *     .create in the session, named `run-<epoch ms>` as the console names
 *     its turns (runs claim no unique name). The server writes the turn's
 *     user.message in the same transaction as the run, under an id the
 *     create does not return, so the lane reads it back by the run's id.
 *   - user.tool_confirmation answers a call that waits:
 *     SessionCommandController.confirmToolUse.
 *   - user.interrupt stops the session's unfinished work:
 *     SessionCommandController.interrupt. Stigmer stops the whole session,
 *     so a thread id is refused.
 *
 * Stop and approve stay separate methods, so a guard that admits by method
 * name (a share guest may stop, never approve) holds here unchanged.
 *
 * The whole list is checked before anything applies: an event Stigmer does
 * not serve (user.tool_result, custom tools, outcomes, system.message, an
 * image or document block) refuses the request with nothing applied. Then
 * the events apply in order; one that fails stops the list and its error is
 * the answer, while the ones before it stay applied, as their methods
 * committed them.
 *
 * Proven by __tests__/send.test.ts and the session-events-managed-agents
 * conformance suites.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  ConfirmToolUseInputSchema,
  InterruptSessionInputSchema,
  ListSessionEventsRequestSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { toManagedAgentsJson } from "@stigmer/session-log";

import type { LaneResponse } from "../lanes.js";
import type { LaneCall } from "./call.js";
import { invalidRequest, isLaneError, type LaneError } from "./errors.js";
import { writeJson } from "./respond.js";

/** An event the lane applies, checked. */
export type SendEvent =
  | { readonly type: "user.message"; readonly text: string }
  | {
      readonly type: "user.tool_confirmation";
      readonly toolUseId: string;
      readonly result: "allow" | "deny";
      readonly denyMessage: string;
    }
  | { readonly type: "user.interrupt" };

/** How a user.message's text blocks join into the turn's one message. */
export const TEXT_BLOCK_SEPARATOR = "\n\n";

const SERVED_EVENT_TYPES = "user.message, user.tool_confirmation and user.interrupt";

/** Checks a send's whole body (module header); nothing applies unless every event passes. */
export function parseSendBody(body: unknown): readonly SendEvent[] | LaneError {
  if (!isObject(body) || !Array.isArray(body["events"])) {
    return invalidRequest("the body must be an object with an events array");
  }
  const events: unknown[] = body["events"];
  if (events.length === 0) {
    return invalidRequest("events must hold at least one event");
  }
  const parsed: SendEvent[] = [];
  for (const [index, event] of events.entries()) {
    const result = parseEvent(event);
    if (isLaneError(result)) {
      return invalidRequest(`events[${index}]: ${result.message}`);
    }
    parsed.push(result);
  }
  return parsed;
}

function parseEvent(event: unknown): SendEvent | LaneError {
  if (!isObject(event) || typeof event["type"] !== "string") {
    return invalidRequest("each event must be an object with a type");
  }
  const type = event["type"];
  switch (type) {
    case "user.message":
      return parseMessage(event);
    case "user.tool_confirmation":
      return parseConfirmation(event);
    case "user.interrupt": {
      const thread = event["session_thread_id"];
      if (thread !== undefined && thread !== null && thread !== "") {
        return invalidRequest("Stigmer stops the whole session; session_thread_id must be absent");
      }
      return { type: "user.interrupt" };
    }
    default:
      return invalidRequest(`Stigmer does not serve '${type}' events; this API accepts ${SERVED_EVENT_TYPES}`);
  }
}

function parseMessage(event: JsonLike): SendEvent | LaneError {
  const content = event["content"];
  if (!Array.isArray(content) || content.length === 0) {
    return invalidRequest("a user.message needs at least one content block");
  }
  const texts: string[] = [];
  for (const block of content as unknown[]) {
    if (!isObject(block) || block["type"] !== "text") {
      const blockType = isObject(block) && typeof block["type"] === "string" ? block["type"] : "unknown";
      return invalidRequest(`Stigmer accepts only text blocks in a user.message, not '${blockType}'`);
    }
    if (typeof block["text"] !== "string") {
      return invalidRequest("a text block needs its text");
    }
    texts.push(block["text"]);
  }
  return { type: "user.message", text: texts.join(TEXT_BLOCK_SEPARATOR) };
}

function parseConfirmation(event: JsonLike): SendEvent | LaneError {
  const toolUseId = event["tool_use_id"];
  const result = event["result"];
  const denyMessage = event["deny_message"] ?? "";
  if (typeof toolUseId !== "string" || toolUseId === "") {
    return invalidRequest("a user.tool_confirmation needs its tool_use_id");
  }
  if (result !== "allow" && result !== "deny") {
    return invalidRequest("a user.tool_confirmation's result must be allow or deny");
  }
  if (typeof denyMessage !== "string") {
    return invalidRequest("deny_message must be a string");
  }
  if (denyMessage !== "" && result !== "deny") {
    return invalidRequest("deny_message is only allowed when result is deny");
  }
  return { type: "user.tool_confirmation", toolUseId, result, denyMessage };
}

/** Applies the checked events in order and answers the recorded ones; a native refusal throws. */
export async function serveSend(
  call: LaneCall,
  events: readonly SendEvent[],
  response: LaneResponse,
  now: () => number,
): Promise<number> {
  const recorded: JsonObject[] = [];
  for (const event of events) {
    recorded.push(toManagedAgentsJson(await apply(call, event, now)));
  }
  writeJson(response, 200, call.requestId, { data: recorded });
  return 200;
}

async function apply(call: LaneCall, event: SendEvent, now: () => number): Promise<SessionEvent> {
  switch (event.type) {
    case "user.message":
      return startTurn(call, event.text, now);
    case "user.tool_confirmation":
      return call.clients.sessionCommand.confirmToolUse(
        create(ConfirmToolUseInputSchema, {
          sessionId: call.sessionId,
          toolUseId: event.toolUseId,
          result: event.result,
          denyMessage: event.denyMessage,
        }),
        call.options,
      );
    case "user.interrupt": {
      const interrupted = await call.clients.sessionCommand.interrupt(
        create(InterruptSessionInputSchema, { sessionId: call.sessionId }),
        call.options,
      );
      if (interrupted.event === undefined) {
        throw unrecorded("user.interrupt");
      }
      return interrupted.event;
    }
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

async function startTurn(call: LaneCall, message: string, now: () => number): Promise<SessionEvent> {
  const run = await call.clients.runCommand.create(
    create(RunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Run",
      metadata: { name: `run-${now()}` },
      spec: { target: { case: "sessionId", value: call.sessionId }, message },
    }),
    call.options,
  );
  const page = await call.clients.sessionQuery.listEvents(
    create(ListSessionEventsRequestSchema, {
      sessionId: call.sessionId,
      runId: run.metadata?.id ?? "",
      types: ["user.message"],
      pageSize: 1,
    }),
    call.options,
  );
  const written = page.events[0];
  if (written === undefined) {
    throw unrecorded("user.message");
  }
  return written;
}

/**
 * A method that answered without the event it records: an internal fault,
 * answered as one (errors.ts) and logged with this text by the lane.
 */
function unrecorded(type: string): Error {
  return new Error(`the ${type} was applied but its recorded event could not be read`);
}

type JsonLike = Record<string, unknown>;

function isObject(value: unknown): value is JsonLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
