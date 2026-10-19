/**
 * `POST /v1/sessions/{id}/events`: a person's events sent to a session,
 * `{events:[…]}` in, `{data:[…the recorded events]}` out.
 *
 * Three events are served, each through the native method that owns it,
 * so each meets that method's own authorization and the composed guards:
 *
 *   - user.message starts a turn: RunCommandController.create in the
 *     session, named `run-<epoch ms>` as the console names its turns (runs
 *     claim no unique name). Its text blocks join into the turn's message;
 *     its image and document blocks name Files by id (a `file` source) and
 *     become the turn's file_ids, so the conversation gets its own copy of
 *     each and the turn's user.message carries the blocks back. The server
 *     writes that event in the same transaction as the run, under an id
 *     the create does not return, so the lane reads it back by the run's
 *     id.
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
 * not serve (user.tool_result, custom tools, outcomes, system.message), a
 * block with a base64 or url source (Stigmer names files by id: upload the
 * bytes with its File API first), a document's title, context, citations
 * or cache_control (Stigmer would not carry them to the model, so the event
 * read back would differ from the one sent), and an image block naming a
 * File that is not an image refuse the request with nothing applied. Then
 * the events apply in order; one that fails stops the list and its error is
 * the answer, while the ones before it stay applied, as their methods
 * committed them.
 *
 * Proven by __tests__/send.test.ts and the session-events-managed-agents
 * conformance suites.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";

import { FileIdSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
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
  | { readonly type: "user.message"; readonly text: string; readonly files: readonly MessageFile[] }
  | {
      readonly type: "user.tool_confirmation";
      readonly toolUseId: string;
      readonly result: "allow" | "deny";
      readonly denyMessage: string;
    }
  | { readonly type: "user.interrupt" };

/** A file a user.message names, and the block it came in. */
export interface MessageFile {
  readonly fileId: string;
  readonly block: "image" | "document";
}

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

/** The fields of an image or document block Stigmer would not carry to the model. */
const UNCARRIED_BLOCK_FIELDS = ["title", "context", "citations", "cache_control"] as const;

function parseMessage(event: JsonLike): SendEvent | LaneError {
  const content = event["content"];
  if (!Array.isArray(content) || content.length === 0) {
    return invalidRequest("a user.message needs at least one content block");
  }
  const texts: string[] = [];
  const files: MessageFile[] = [];
  for (const block of content as unknown[]) {
    const blockType = isObject(block) && typeof block["type"] === "string" ? block["type"] : "unknown";
    if (!isObject(block) || (blockType !== "text" && blockType !== "image" && blockType !== "document")) {
      return invalidRequest(`Stigmer accepts text, image and document blocks in a user.message, not '${blockType}'`);
    }
    if (blockType === "text") {
      if (typeof block["text"] !== "string") {
        return invalidRequest("a text block needs its text");
      }
      texts.push(block["text"]);
      continue;
    }
    const file = parseFileBlock(block, blockType === "image" ? "image" : "document");
    if (isLaneError(file)) {
      return file;
    }
    files.push(file);
  }
  return { type: "user.message", text: texts.join(TEXT_BLOCK_SEPARATOR), files };
}

function parseFileBlock(block: JsonLike, kind: "image" | "document"): MessageFile | LaneError {
  const named = kind === "image" ? "an image block" : "a document block";
  for (const field of UNCARRIED_BLOCK_FIELDS) {
    if (block[field] !== undefined && block[field] !== null) {
      return invalidRequest(`Stigmer does not carry ${named}'s ${field}; send the block without it`);
    }
  }
  const source = block["source"];
  if (!isObject(source) || typeof source["type"] !== "string") {
    return invalidRequest(`${named} needs a source`);
  }
  if (source["type"] !== "file") {
    return invalidRequest(
      `Stigmer names ${named}'s bytes by File id, not a '${source["type"]}' source: upload the file with Stigmer's File API and name its id`,
    );
  }
  const fileId = source["file_id"];
  if (typeof fileId !== "string" || fileId === "") {
    return invalidRequest(`a file source needs its file_id`);
  }
  return { fileId, block: kind };
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

/** The types an image block may name: Claude's image types. */
const IMAGE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * The checks that read a File, before anything applies: an image block
 * names an image File, and a document block names a File that is not one
 * (the server records an image File as an image block, so a document
 * block naming one would read back as something the client did not send).
 * A File the caller cannot read answers as the File query answers (a
 * native refusal throws).
 */
export async function checkSendFiles(call: LaneCall, events: readonly SendEvent[]): Promise<LaneError | undefined> {
  for (const [index, event] of events.entries()) {
    if (event.type !== "user.message") {
      continue;
    }
    for (const file of event.files) {
      const found = await call.clients.fileQuery.get(create(FileIdSchema, { value: file.fileId }), call.options);
      const mimeType = found.spec?.mimeType ?? "";
      if (file.block === "image" && !IMAGE_TYPES.has(mimeType)) {
        return invalidRequest(`events[${index}]: file ${file.fileId} is ${mimeType}, not an image: send it in a document block`);
      }
      if (file.block === "document" && IMAGE_TYPES.has(mimeType)) {
        return invalidRequest(`events[${index}]: file ${file.fileId} is ${mimeType}, an image: send it in an image block`);
      }
    }
  }
  return undefined;
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
      return startTurn(call, event, now);
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

async function startTurn(
  call: LaneCall,
  message: Extract<SendEvent, { type: "user.message" }>,
  now: () => number,
): Promise<SessionEvent> {
  const run = await call.clients.runCommand.create(
    create(RunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Run",
      metadata: { name: `run-${now()}` },
      spec: {
        target: { case: "sessionId", value: call.sessionId },
        message: message.text,
        fileIds: message.files.map((file) => file.fileId),
      },
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
