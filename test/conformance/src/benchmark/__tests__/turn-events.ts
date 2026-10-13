// Event fixtures for the benchmark's readers: a turn's session events, named
// the way the runner names them (`<run>.<call>` for a tool use, `<run>.root.m<n>`
// for a primary-thread message), folded the way every client folds them
// (@stigmer/session-log). The readers take a folded `Turn`;
// the tests build the log a turn would leave and fold it.
// Domain: conformance benchmark (test fixtures).
import { create, type JsonObject, type MessageInitShape } from "@bufbuild/protobuf";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { foldSession, turnOf, type Turn } from "@stigmer/session-log";

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

export const RUN = "run_1";

let seq = 0n;

/** One stored event of the run, on a thread ("" for the primary). */
export function ev(event: EventInit, threadId = ""): SessionEvent {
  seq += 1n;
  return create(SessionEventSchema, { seq, sessionId: "ses_1", runId: RUN, threadId, event });
}

const text = (t: string) => [{ type: "text", text: t }];

export function userMessage(message: string): SessionEvent {
  return ev({ case: "userMessage", value: { id: `${RUN}.user`, content: text(message) } });
}

/** An agent message; `scope` is `root` for the primary thread, the task call's id for a thread. */
export function said(index: number, message: string, scope = "root", threadId = ""): SessionEvent {
  return ev({ case: "agentMessage", value: { id: `${RUN}.${scope}.m${index}`, content: text(message) } }, threadId);
}

/** The agent's thinking with its text. */
export function thought(index: number, message: string): SessionEvent[] {
  const id = `${RUN}.root.t${index}`;
  return [
    ev({ case: "agentThinking", value: { id } }),
    ev({ case: "stigmerAgentThinking", value: { id: `${id}.text`, thinkingId: id, text: message } }),
  ];
}

/** A built-in tool use. */
export function use(call: string, name: string, input: JsonObject = {}, threadId = ""): SessionEvent {
  return ev(
    { case: "agentToolUse", value: { id: `${RUN}.${call}`, name, input, sessionThreadId: threadId } },
    threadId,
  );
}

/** A built-in tool's result. */
export function result(call: string, output: string, opts: { isError?: boolean; threadId?: string } = {}): SessionEvent {
  const useId = `${RUN}.${call}`;
  return ev(
    { case: "agentToolResult", value: { id: `${useId}.r`, toolUseId: useId, content: text(output), isError: opts.isError ?? false } },
    opts.threadId ?? "",
  );
}

/** A person's deny of a waiting call. */
export function denied(call: string): SessionEvent {
  return ev({ case: "userToolConfirmation", value: { id: `${RUN}.${call}.deny`, toolUseId: `${RUN}.${call}`, result: "deny" } });
}

/** A sub-agent's thread, opened by the task call `call`, with one message of its own. */
export function subAgentThread(call: string, message: string): SessionEvent[] {
  const thread = `${RUN}.${call}`;
  return [
    use(call, "task", { description: "research" }),
    ev({ case: "sessionThreadCreated", value: { id: `${thread}.created`, agentName: "researcher", sessionThreadId: thread } }),
    said(0, message, call, thread),
  ];
}

/** The turn's phase, as the server states it. */
export function phase(word: string): SessionEvent {
  return ev({ case: "stigmerRunStatus", value: { id: `${RUN}.status.${word}.${seq}`, phase: word } });
}

/** The turn's edits offered for review. */
export function offered(changeSetId: string): SessionEvent {
  return ev({ case: "stigmerFileReviewChanges", value: { id: `${changeSetId}.fr`, changeSetId } });
}

/** The run's turn, folded from `events`. */
export function turnFrom(events: Iterable<SessionEvent>): Turn {
  const turn = turnOf(foldSession(events), RUN);
  if (turn === undefined) throw new Error("the fixture log holds no turn");
  return turn;
}
