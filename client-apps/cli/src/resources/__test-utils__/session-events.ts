// Hand-built session events for the suites that read a conversation from its
// log (the headless stream, its renderers, runs logs/trace/approve, resume,
// the epilogue). Each builder makes one stored event of a run, numbered in
// log order, with the ids the runner derives (`<run>.root.m<n>` for a
// message, `<run>.<call>` for a tool use), so the fold pairs them as it does
// a real log.

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import {
  StreamSessionEventsResponseSchema,
  type StreamSessionEventsResponse,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

let seq = 0n;

/** One stored event of a run ("" for a session-level event), on a thread ("" for the primary). */
export function ev(runId: string, event: EventInit, threadId = ""): SessionEvent {
  seq += 1n;
  return create(SessionEventSchema, { seq, sessionId: "ses_1", runId, threadId, event });
}

const text = (t: string) => [{ type: "text", text: t }];

/** The person's message that starts the run's turn. */
export function user(runId: string, message: string): SessionEvent {
  return ev(runId, { case: "userMessage", value: { id: `${runId}.user`, content: text(message), processedAt: "t0" } });
}

/** The agent's message number `index` on the primary thread, or on `threadId`. */
export function said(runId: string, index: number, message: string, threadId = ""): SessionEvent {
  const scope = threadId === "" ? "root" : "sub";
  return ev(runId, { case: "agentMessage", value: { id: `${runId}.${scope}.m${index}`, content: text(message) } }, threadId);
}

export interface UseOptions {
  /** "ask" makes the call wait for a person until it is answered. */
  readonly permission?: string;
  readonly input?: Record<string, unknown>;
  readonly threadId?: string;
}

/** A built-in tool use `<run>.<call>`. */
export function use(runId: string, call: string, name: string, options: UseOptions = {}): SessionEvent {
  const threadId = options.threadId ?? "";
  return ev(
    runId,
    {
      case: "agentToolUse",
      value: {
        id: `${runId}.${call}`,
        name,
        input: (options.input ?? {}) as never,
        evaluatedPermission: options.permission ?? "",
        sessionThreadId: threadId,
      },
    },
    threadId,
  );
}

/** The result of the tool use `<run>.<call>`. */
export function result(runId: string, call: string, output: string, isError = false, threadId = ""): SessionEvent {
  const toolUseId = `${runId}.${call}`;
  return ev(
    runId,
    { case: "agentToolResult", value: { id: `${toolUseId}.r`, toolUseId, content: text(output), isError } },
    threadId,
  );
}

/** Why the tool use `<run>.<call>` waits for a person. */
export function asked(runId: string, call: string): SessionEvent {
  const toolUseId = `${runId}.${call}`;
  return ev(runId, { case: "stigmerPermissionAsked", value: { id: `${toolUseId}.ask`, toolUseId, message: "Run it?" } });
}

/** A person's answer to the tool use `<run>.<call>`. */
export function confirmed(runId: string, call: string, answer: "allow" | "deny"): SessionEvent {
  const toolUseId = `${runId}.${call}`;
  return ev(runId, { case: "userToolConfirmation", value: { id: `${toolUseId}.c`, toolUseId, result: answer } });
}

/** The run's phase, as the server writes it. */
export function phase(runId: string, word: string, error = ""): SessionEvent {
  return ev(runId, { case: "stigmerRunStatus", value: { id: `${runId}.status.${word}.${seq}`, phase: word, error } });
}

/** The session idles; with `requires_action`, waiting on the named tool uses. */
export function idle(reason: string, waitingOn: string[] = []): SessionEvent {
  return ev("", { case: "sessionStatusIdle", value: { id: `idle.${seq}`, stopReason: { type: reason, eventIds: waitingOn } } });
}

/** A subagent thread `threadId`, opened by a `task` tool use, starting to work. */
export function threadRunning(runId: string, threadId: string, agentName: string): SessionEvent {
  return ev(runId, { case: "sessionThreadStatusRunning", value: { id: `${threadId}.running`, agentName, sessionThreadId: threadId } });
}

/** The subagent thread `threadId` going idle: done, or failed for any other reason. */
export function threadIdle(runId: string, threadId: string, reason: string): SessionEvent {
  return ev(runId, { case: "sessionThreadStatusIdle", value: { id: `${threadId}.idle`, sessionThreadId: threadId, stopReason: { type: reason } } });
}

/** An error event of the run. */
export function failure(runId: string, id: string, message: string): SessionEvent {
  return ev(runId, { case: "sessionError", value: { id, error: { type: "unknown_error", message } } });
}

/** A line in the platform's own voice. */
export function note(runId: string, id: string, message: string): SessionEvent {
  return ev(runId, { case: "stigmerHarnessNote", value: { id, text: message } });
}

/** A stored event as a stream frame. */
export function frameOf(event: SessionEvent): StreamSessionEventsResponse {
  return create(StreamSessionEventsResponseSchema, { frame: { case: "event", value: event } });
}
