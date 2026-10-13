// Run read path: the polling primitive behind get_run.
//
// A run is one turn of a conversation. Its record holds the turn's
// lifecycle (phase, timing, error, stop cause, setup, usage, the files it
// wrote, the agent and versions it ran); what the agent did is the
// session's event log (Claude Managed Agents events), read with
// SessionQueryController.listEvents filtered to the run. So get_run reads
// both: the run for its lifecycle, and the run's events.
//
// The events reach the model in one of two shapes:
//   - compact (the default): the turn as the shared fold (`foldSession`
//     from @stigmer/sdk) reads it, summarized: its phase, its answer, the
//     tool uses that wait for an answer (with the `tool_use_id`
//     submit_run_approval names), its to-do list, its changed files, and a
//     bounded tail of its items. A model polling a run needs exactly that,
//     and the fold has already paired each result, ask and answer with its
//     tool use, so nothing is left to correlate by hand. The tail bound
//     keeps a long turn from flooding the model's context; total_items
//     says when the tail is a window.
//   - full: every event of the run as Managed Agents JSON, for a model
//     that genuinely needs the raw log.
// Either way the fold reads the whole turn: which tool uses still wait is
// only known from all of the turn's events.

import type { CallOptions, Transport } from "@connectrpc/connect";
import { createClient } from "@connectrpc/connect";
import { toJson, type JsonObject, type JsonValue } from "@bufbuild/protobuf";
import { RunSchema, type Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import {
  foldSession,
  toManagedAgentsJson,
  type FileReviewSet,
  type ToolUse,
  type Turn,
  type TurnItem,
} from "@stigmer/sdk";

import { withTransport } from "../client.js";
import { rpcError } from "../rpcerr.js";

export type RunView = "compact" | "full";

/** Item-tail size when the caller doesn't specify one. */
export const DEFAULT_ITEM_LIMIT = 5;

/** The most events one listEvents page returns. */
const EVENT_PAGE_SIZE = 1000;

/** Fetch a run and its events, shaped for the requested view. */
export async function fetchRun(
  serverAddress: string,
  token: string,
  runId: string,
  view: RunView,
  itemLimit: number,
): Promise<string> {
  if (runId === "") {
    throw new Error("run_id is required");
  }
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const run = await getRun(transport, callOptions, runId);
    const sessionId = sessionIdOf(run);
    const events = await listRunEvents(transport, callOptions, sessionId, runId);
    const body =
      view === "full"
        ? { view, run: runLifecycle(run), events: events.filter(holdsEvent).map(toManagedAgentsJson) }
        : { view, run: runLifecycle(run), turn: turnView(foldSession(events).turns.find((t) => t.runId === runId), itemLimit) };
    return JSON.stringify(body, null, 2);
  });
}

/** Read one run, its failure named after it. */
export async function getRun(transport: Transport, callOptions: CallOptions, runId: string): Promise<Run> {
  try {
    return await createClient(RunQueryController, transport).get({ value: runId }, callOptions);
  } catch (err) {
    throw rpcError(err, `run "${runId}"`);
  }
}

/** The session a stored run belongs to: the server records it on every run it persists. */
export function sessionIdOf(run: Run): string {
  const target = run.spec?.target;
  if (target?.case === "sessionId" && target.value !== "") {
    return target.value;
  }
  throw new Error(`run "${run.metadata?.id ?? ""}" names no session`);
}

/** The run's record as protojson: its lifecycle (module header). */
export function runLifecycle(run: Run): JsonObject {
  return toJson(RunSchema, run, { useProtoFieldName: true }) as JsonObject;
}

/** Every event of one run, oldest first, walking every page. */
async function listRunEvents(
  transport: Transport,
  callOptions: CallOptions,
  sessionId: string,
  runId: string,
): Promise<SessionEvent[]> {
  const client = createClient(SessionQueryController, transport);
  const events: SessionEvent[] = [];
  let pageToken = "";
  try {
    do {
      const page = await client.listEvents({ sessionId, runId, pageSize: EVENT_PAGE_SIZE, pageToken }, callOptions);
      events.push(...page.events);
      pageToken = page.nextPageToken;
    } while (pageToken !== "");
  } catch (err) {
    throw rpcError(err, `the events of run "${runId}"`);
  }
  return events;
}

/** Whether an event holds a member this build knows; a newer server's unknown event is left out of the JSON. */
function holdsEvent(event: SessionEvent): boolean {
  return event.event.case !== undefined;
}

/** The turn, summarized for a model; null before the run's first event. */
function turnView(turn: Turn | undefined, itemLimit: number): JsonValue {
  if (turn === undefined) {
    return null;
  }
  return {
    phase: turn.status?.phase ?? "",
    ended: turn.ended,
    stop_cause: turn.status?.stopCause ?? "",
    error: turn.status?.error ?? "",
    answer: turn.answer,
    asks: turn.asks.map(askView),
    todos: turn.todos.map((todo) => ({ content: todo.content, status: todo.status })),
    structured_output: turn.structuredOutput ?? null,
    file_review: turn.fileReview.map(fileReviewView),
    errors: turn.errors.map((error) => ({ type: error.type, message: error.message })),
    total_items: turn.items.length,
    items: turn.items.slice(-itemLimit).map(itemView),
  };
}

/** A tool use that waits for a person's answer, with the id the answer names. */
function askView(tool: ToolUse): JsonObject {
  return {
    tool_use_id: tool.id,
    name: tool.name,
    mcp_server_name: tool.mcpServerName,
    input: tool.input,
    message: tool.ask?.message ?? "",
    args_preview: tool.ask?.argsPreview ?? "",
  };
}

function fileReviewView(set: FileReviewSet): JsonObject {
  return {
    change_set_id: set.changeSetId,
    undecided: set.undecided,
    files: set.files.map((file) => ({ path: file.path, change: file.change, state: file.state })),
  };
}

function itemView(item: TurnItem): JsonObject {
  switch (item.kind) {
    case "message":
    case "thinking":
    case "note":
      return { type: item.kind, text: item.text };
    case "compacted":
      return { type: item.kind };
    case "tool_use":
      return toolView(item);
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = item;
      throw new Error(`unknown turn item ${String(exhaustive)}`);
    }
  }
}

function toolView(tool: ToolUse): JsonObject {
  const view: JsonObject = {
    type: "tool_use",
    tool_use_id: tool.id,
    name: tool.name,
    mcp_server_name: tool.mcpServerName,
    state: tool.state,
    input: tool.input,
    result: tool.result?.text ?? "",
  };
  if (tool.fullOutput !== undefined) {
    // The result is the stored output's head; the whole output is the run's artifact.
    view["full_output"] = {
      storage_key: tool.fullOutput.storageKey,
      size_bytes: tool.fullOutput.sizeBytes.toString(),
      mime_type: tool.fullOutput.mimeType,
    };
  }
  if (tool.thread !== undefined) {
    view["sub_agent"] = {
      agent_name: tool.thread.agentName,
      state: tool.thread.state,
      reply: tool.thread.reply,
      total_items: tool.thread.items.length,
    };
  }
  return view;
}
