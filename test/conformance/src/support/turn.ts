// What a turn did, as the session's event log states it.
// Domain: conformance support (a turn's transcript is session events).
//
// A run carries a turn's lifecycle and stamps; what the agent said, which
// tools it called and how they ended, its sub-agents, to-dos, structured
// output and memory recall, and every file-review decision are the
// session's events. These helpers fold that log the way every client does
// (`foldSession` from @stigmer/session-log: pure functions over the
// contract's event protos, no transport) and hand a suite the turn's items. Nothing here reads a run's status for the
// transcript.
//
// A tool use is found by the call id the scripted model gave it: the runner
// names its event `<run id>.<call id>` (the runner's harness/events/ids.ts,
// for a call id that fits the event id pattern, which every scripted id
// here does).
import {
  foldSession,
  turnOf,
  type FileReviewSet,
  type MessageItem,
  type SessionFold,
  type Thread,
  type ToolUse,
  type Turn,
  type TurnItem,
} from "@stigmer/session-log";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { ConformanceClients } from "../harness/clients";
import { sessionLog } from "./answers";
import { sessionIdOf } from "./runs";

// The session's whole log, folded.
export async function sessionFold(clients: ConformanceClients, sessionId: string): Promise<SessionFold> {
  return foldSession(await sessionLog(clients, sessionId));
}

// The turn `runId` of a folded log; throws, naming the turns the log holds,
// when it has none by that id.
export function requireTurn(fold: SessionFold, runId: string): Turn {
  const turn = turnOf(fold, runId);
  if (turn === undefined) {
    throw new Error(`the session's log holds no turn ${runId} (turns: ${JSON.stringify(fold.turns.map((t) => t.runId))})`);
  }
  return turn;
}

// The turn `runId` of session `sessionId`, as its log reads now.
export async function turnById(clients: ConformanceClients, sessionId: string, runId: string): Promise<Turn> {
  return requireTurn(await sessionFold(clients, sessionId), runId);
}

// A run's turn, read from its session's log.
export function turnOfRun(clients: ConformanceClients, run: Run): Promise<Turn> {
  const runId = run.metadata?.id ?? "";
  const sessionId = sessionIdOf(run);
  if (runId === "" || sessionId === "") {
    throw new Error(`run ${JSON.stringify(runId)} names no session to read its turn from`);
  }
  return turnById(clients, sessionId, runId);
}

// The turn `runId` of an already-read log.
export function turnOfEvents(events: Iterable<SessionEvent>, runId: string): Turn {
  return requireTurn(foldSession(events), runId);
}

// Every tool use of a turn or thread, in the order the agent made them: a
// sub-agent's calls follow the `task` call that started it.
export function toolUsesOf(source: Turn | Thread): ToolUse[] {
  const out: ToolUse[] = [];
  const walk = (items: ReadonlyArray<TurnItem>) => {
    for (const item of items) {
      if (item.kind !== "tool_use") continue;
      out.push(item);
      if (item.thread !== undefined) walk(item.thread.items);
    }
  };
  walk(source.items);
  return out;
}

// The tool use the scripted model called `callId`, in any thread of the turn.
export function toolUseByCallId(turn: Turn, callId: string): ToolUse | undefined {
  const id = `${turn.runId}.${callId}`;
  return toolUsesOf(turn).find((use) => use.id === id);
}

// Every sub-agent thread of a turn, nested ones included, in the order they
// were started.
export function threadsOf(turn: Turn): Thread[] {
  return toolUsesOf(turn).flatMap((use) => (use.thread === undefined ? [] : [use.thread]));
}

// The messages the agent wrote on a turn's primary thread, in order.
export function messagesOf(source: Turn | Thread): MessageItem[] {
  return source.items.filter((item): item is MessageItem => item.kind === "message");
}

// The folded review of change set `changeSetId`, from whichever turn changed
// its files; undefined while the log has not offered it.
export function reviewSetOf(fold: SessionFold, changeSetId: string): FileReviewSet | undefined {
  for (const turn of fold.turns) {
    const set = turn.fileReview.find((candidate) => candidate.changeSetId === changeSetId);
    if (set !== undefined) return set;
  }
  return undefined;
}
