/**
 * Test support: one turn's session events, written in the order and with
 * the ids the runner writes them (runner harness/events/emitter.ts and
 * ids.ts): per message, the message (none for an empty one), then its tool
 * uses, then their results, an offloaded result's location after it, and
 * the structured answer last. The server's user message opens the turn.
 * Each event takes the next seq, so a fixture reads as a stored log.
 *
 * `appendRunEvents` stores a fixture under a run row the test saved, the
 * way the runner's append is guarded by its run.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject, MessageInitShape } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../../../store/interface.js";
import { draftOf } from "../codec.js";

type EventValue = MessageInitShape<typeof SessionEventSchema>["event"];

/** One tool call as a fixture names it. */
export interface FixtureCall {
  /** The provider's call id; the tool use event id is `<run>.<id>`. */
  readonly id: string;
  readonly name: string;
  readonly input?: JsonObject;
  /** The MCP server's name, for an MCP tool. */
  readonly mcpServer?: string;
  /** The result's text; no result event when undefined (the call never settled). */
  readonly result?: string;
  readonly isError?: boolean;
  /** The offloaded output's content hash, when the runner offloaded it. */
  readonly offloadedHash?: string;
  /** A person denied it (`user.tool_confirmation` deny). */
  readonly denied?: boolean;
  /** The thread that made it; "" for the primary thread. */
  readonly threadId?: string;
}

/** Builds one turn's events in log order. */
export class RunEventsBuilder {
  private readonly events: SessionEvent[] = [];
  private messageIndex = 0;

  constructor(
    readonly runId: string,
    private seq = 1,
  ) {}

  /** The turn's user message (the server's). */
  user(text: string, id = `${this.runId}.user`): this {
    return this.push("", {
      case: "userMessage",
      value: { id, content: [{ type: "text", text }] },
    });
  }

  /**
   * One assistant message and its calls: the message (when it has text),
   * each call's use, then each settled call's result and offloaded output.
   */
  turnMessage(
    text: string,
    calls: ReadonlyArray<FixtureCall> = [],
    threadId = "",
  ): this {
    const index = this.messageIndex++;
    if (text !== "") {
      const id = `${this.runId}.root.m${index}`;
      this.push(threadId, {
        case: "agentMessage",
        value: { id, content: [{ type: "text", text }] },
      });
    }
    for (const call of calls) {
      const id = this.toolUseId(call);
      const input = call.input ?? {};
      const thread = call.threadId ?? threadId;
      if (call.mcpServer === undefined) {
        this.push(thread, {
          case: "agentToolUse",
          value: {
            id,
            input,
            name: call.name,
            evaluatedPermission: call.denied === true ? "ask" : "",
            sessionThreadId: thread,
          },
        });
      } else {
        this.push(thread, {
          case: "agentMcpToolUse",
          value: {
            id,
            input,
            name: call.name,
            mcpServerName: call.mcpServer,
            evaluatedPermission: "",
            sessionThreadId: thread,
          },
        });
      }
      if (call.denied === true) {
        this.push("", {
          case: "userToolConfirmation",
          value: {
            id: `${id}.confirm`,
            toolUseId: id,
            result: "deny",
            denyMessage: "no",
          },
        });
      }
    }
    for (const call of calls) {
      if (call.result === undefined) {
        continue;
      }
      const useId = this.toolUseId(call);
      const resultId = `${useId}.r`;
      const content =
        call.result === "" ? [] : [{ type: "text", text: call.result }];
      const isError = call.isError === true;
      const thread = call.threadId ?? threadId;
      if (call.mcpServer === undefined) {
        this.push(thread, {
          case: "agentToolResult",
          value: { id: resultId, toolUseId: useId, content, isError },
        });
      } else {
        this.push(thread, {
          case: "agentMcpToolResult",
          value: { id: resultId, mcpToolUseId: useId, content, isError },
        });
      }
      if (call.offloadedHash !== undefined) {
        this.push(thread, {
          case: "stigmerToolResultFullOutput",
          value: {
            id: `${useId}.full`,
            toolUseId: useId,
            storageKey: `artifacts/${this.runId}/${call.id}`,
            sizeBytes: 1n,
            contentHash: call.offloadedHash,
            mimeType: "text/plain",
            isImage: false,
          },
        });
      }
    }
    return this;
  }

  /** A thinking (`agent.thinking`, its text in `stigmer.agent.thinking`). */
  thinking(text: string): this {
    const id = `${this.runId}.root.t${this.messageIndex++}`;
    this.push("", { case: "agentThinking", value: { id } });
    return this.push("", {
      case: "stigmerAgentThinking",
      value: { id: `${id}.text`, thinkingId: id, text },
    });
  }

  /** A line the harness added (`stigmer.harness.note`). */
  note(text: string): this {
    return this.push("", {
      case: "stigmerHarnessNote",
      value: { id: `${this.runId}.root.n${this.messageIndex++}`, text },
    });
  }

  /** An event of a type this server's contract does not name (a newer writer's). */
  unknown(): this {
    return this.push("", { case: undefined });
  }

  /** A sub-agent's thread opens (written on the primary thread). */
  threadCreated(threadId: string, agentName: string): this {
    return this.push("", {
      case: "sessionThreadCreated",
      value: {
        id: `${threadId}.created`,
        agentName,
        sessionThreadId: threadId,
      },
    });
  }

  /** The session's own status (`session.status_running` or `session.status_idle`, the server's). */
  sessionStatus(state: "running" | "idle"): this {
    const id = `${this.runId}.session.${state}.${this.seq}`;
    return this.push(
      "",
      state === "running"
        ? { case: "sessionStatusRunning", value: { id } }
        : {
            case: "sessionStatusIdle",
            value: { id, stopReason: { type: "end_turn" } },
          },
    );
  }

  /** The turn's own phase (`stigmer.run.status`, the server's). */
  runStatus(phase: string, error = ""): this {
    return this.push("", {
      case: "stigmerRunStatus",
      value: { id: `${this.runId}.status.${phase}`, phase, error },
    });
  }

  /** The turn's structured answer. */
  structuredOutput(output: JsonObject): this {
    return this.push("", {
      case: "stigmerAgentStructuredOutput",
      value: { id: `${this.runId}.output`, output },
    });
  }

  build(): SessionEvent[] {
    return [...this.events];
  }

  private toolUseId(call: FixtureCall): string {
    return `${this.runId}.${call.id}`;
  }

  private push(threadId: string, event: EventValue): this {
    this.events.push(
      create(SessionEventSchema, {
        seq: BigInt(this.seq++),
        runId: this.runId,
        threadId,
        event,
      }),
    );
    return this;
  }
}

/** Stores a fixture's events in `sessionId`, guarded by the run row the test saved. */
export async function appendRunEvents(
  store: Store,
  sessionId: string,
  org: string,
  events: ReadonlyArray<SessionEvent>,
): Promise<void> {
  const runId = events[0]?.runId ?? "";
  await store.sessionEvents.append(sessionId, org, events.map(draftOf), {
    kind: ApiResourceKind.run,
    id: runId,
    schema: RunSchema,
    admit: () => undefined,
  });
}
