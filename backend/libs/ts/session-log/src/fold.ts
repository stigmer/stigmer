/**
 * The fold: a session's events, in log order, become its turns (types.ts).
 * One fold for every client (the SDK, React, Ink, the CLI, MCP, the
 * server's scoring readers and the hosted edition's reply), so a
 * conversation reads the same everywhere.
 *
 * `SessionLog` folds incrementally: `apply` takes stored events (from a
 * list page or a stream), `applyFrame` takes a stream frame (an event or a
 * live preview), and `snapshot` returns the immutable fold. A snapshot
 * reuses every turn, item and thread object that no event touched since
 * the last one, so a client compares by reference and re-renders only what
 * changed. `foldSession` is the one-shot form.
 *
 * How events become items. The runner writes each thread's facts in
 * order (backend/services/runner/src/harness/events/emitter.ts): per
 * message, the message, then its tool uses, then their results; a `task`
 * call's tool use opens its sub-agent's thread, whose id is that tool
 * use's id, and the thread's own events carry it as their `thread_id`. So
 * the fold appends each message, thinking, note and tool use to its
 * thread's items in log order, and pairs the rest by id: a result, an ask
 * (`stigmer.permission.asked`), an answer (`user.tool_confirmation`), a
 * grant and a full-output location name their tool use; a thinking's text
 * names its thinking. An event that names something the log has not shown
 * yet is held until it has. A full-output location is taken only from the
 * tool use's own run and only inside that run's artifacts
 * (`artifacts/<run>/`, no `..` segment): a client fetches it by the tool
 * use's run, as `RunQueryController.getArtifactContent` serves it, so a
 * location naming another run's bytes is never shown as this call's.
 *
 * Previews. `event_start` opens a live message or thinking under the id its
 * stored event will carry, `event_delta` grows a message's text, and
 * `stigmer.tool_output_delta` grows a running tool's output (or, once a
 * tool use that started a background command has its result, that
 * command's output until it ends); the stored
 * event with the same id replaces the live one in place. A preview carries
 * only an id and a type, so the fold reads where it belongs from the id
 * the runner derived (`<run>.<scope>.m<index>`, `<run>.<scope>.t<index>`,
 * scope `root` or a sub-agent's segment; harness/events/ids.ts).
 * `stigmer.run.liveness` names what a working turn has open; the newest
 * one is the turn's `liveness` until the turn ends, less any operation
 * whose result the log already holds. A liveness for a run the log has
 * not shown is dropped, never a turn of its own.
 *
 * Background commands. A tool use that started a command in the
 * background returns at once; the command's own life is
 * `stigmer.background_command.status` (running, then ended), keyed to the
 * tool use, and a person's stop request names it too. They fold into the
 * tool use's `background`, beside its result, never in place of it: the
 * call completed, and the command is a second fact. An ended status that
 * names the agent's stop call marks that call's `stoppedBackground`.
 *
 * A turn's end. The newest `stigmer.run.status` says it. A turn whose
 * events predate that event reads as ended once a later turn began, or
 * once the session went idle for anything but its own open asks. A tool
 * use its ended turn never answered reads `stopped`; nothing more will
 * come for it, and a background command its ended turn never ended reads
 * `stopped` by `turn` for the same reason.
 *
 * Messages a turn did not start with. A message sent while a turn works
 * waits in the session's queue: its `user.message` has no run until a turn
 * reads it, when it streams again, under the same id, as that run's, at
 * the place the turn read it. A sighting with no run is held in `queued`
 * (as `waiting`), never as seen, and the run's copy replaces it, as a
 * stored event replaces its preview. A run's first message is its
 * `userMessage`, and the messages it took with it, before any item of its
 * own (a turn the queue started with several, each read at once), join it,
 * their texts as the turn's message joins them (a blank line between); a
 * later one is a `user_message` item, in log order. A
 * waiting message that a `user.interrupt`, or a `session.error` of no
 * turn, follows was dropped unread: it stays in `queued` as `dropped`.
 *
 * Duplicates. An event already folded (by id) is skipped, so a stream that
 * resumes from an older place, or a list page that overlaps a stream,
 * folds once.
 *
 * Proven by __tests__/fold.test.ts, and over every hermetic event golden
 * of both harnesses by __tests__/goldens.test.ts.
 */
import type { JsonObject } from "@bufbuild/protobuf";
import type { Duration } from "@bufbuild/protobuf/wkt";
import type { ContentBlock } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { StreamSessionEventsResponse } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";

import { applyTodoUpdate, isTodoTool } from "./todos.js";
import {
  TURN_ENDED_PHASES,
  type BackgroundCommandState,
  type BackgroundCommandView,
  type BackgroundStopper,
  type CompactedItem,
  type FileReviewDecision,
  type FileReviewFile,
  type FileReviewReconcile,
  type FileReviewSet,
  type MemoryRecall,
  type MessageItem,
  type NoteItem,
  type PermissionGrant,
  type SessionFold,
  type SessionStatusView,
  type StoppedBackgroundCommand,
  type ThinkingItem,
  type Thread,
  type Todo,
  type ToolAsk,
  type ToolConfirmation,
  type ToolFullOutput,
  type ToolResult,
  type ToolUse,
  type ToolUseState,
  type QueuedMessage,
  type Turn,
  type TurnError,
  type TurnItem,
  type TurnLiveness,
  type TurnOpenOperation,
  type TurnPhase,
  type TurnStatus,
  type UserMessage,
  type UserMessageItem,
} from "./types.js";

/** How the texts of the messages a turn starts with join: as the server joins them into the turn's message. */
const MESSAGE_TEXT_SEPARATOR = "\n\n";

// ── The mutable fold ─────────────────────────────────────────────────────────

/** A cached immutable value, valid while its key holds. */
interface Cached<T> {
  key: string;
  value: T;
}

interface Node {
  /** Bumped (to the fold's clock) on every change to this node or a child. */
  rev: number;
}

interface MutText extends Node {
  readonly kind: "message" | "thinking" | "note" | "compacted" | "user_message";
  readonly id: string;
  text: string;
  live: boolean;
  processedAt: string;
  owner: MutThread | MutTurn;
  cache?: Cached<TurnItem>;
}

interface MutTool extends Node {
  readonly kind: "tool_use";
  readonly id: string;
  readonly runId: string;
  readonly threadId: string;
  readonly name: string;
  readonly mcpServerName: string;
  readonly input: JsonObject;
  readonly evaluatedPermission: string;
  readonly processedAt: string;
  owner: MutThread | MutTurn;
  ask?: ToolAsk;
  confirmation?: ToolConfirmation;
  grant?: PermissionGrant;
  result?: ToolResult;
  fullOutput?: ToolFullOutput;
  liveOutput: string;
  background?: MutBackground;
  stoppedBackground?: string;
  cache?: Cached<ToolUse>;
}

/** A tool use's background command as the log has said it so far. */
interface MutBackground {
  timeoutSeconds: number;
  startedAt: string;
  ended?: {
    readonly state: Exclude<BackgroundCommandState, "running">;
    readonly exitCode: number | undefined;
    readonly stoppedBy: BackgroundStopper | undefined;
    readonly stoppedByToolUseId: string;
    readonly output: string;
    readonly endedAt: string;
  };
  liveOutput: string;
  stopRequested: boolean;
}

/** The endings a status may name, as the contract's words. */
const BACKGROUND_ENDINGS: ReadonlySet<string> = new Set(["exited", "timed_out", "stopped", "failed_to_start"]);
const BACKGROUND_STOPPERS: ReadonlySet<string> = new Set(["agent", "person", "approval", "turn"]);

type MutItem = MutText | MutTool;

interface MutThread extends Node {
  readonly kind: "thread";
  readonly id: string;
  readonly turn: MutTurn;
  agentName: string;
  input: string;
  reply: string;
  state: Thread["state"];
  readonly items: MutItem[];
  cache?: Cached<Thread>;
}

interface MutSet extends Node {
  readonly changeSetId: string;
  readonly runId: string;
  readonly changesEventId: string;
  readonly aggregateDigest: string;
  readonly files: ReadonlyArray<Omit<FileReviewFile, "state" | "decidedBy">>;
  readonly processedAt: string;
  readonly decisions: FileReviewDecision[];
  readonly reconciles: Array<FileReviewReconcile & { readonly decidedEventId: string }>;
  cache?: Cached<FileReviewSet>;
}

interface MutTurn extends Node {
  readonly kind: "turn";
  readonly runId: string;
  userMessage?: UserMessage;
  readonly items: MutItem[];
  readonly threads: Map<string, MutThread>;
  status?: TurnStatus;
  readonly todos: Map<string, Todo>;
  structuredOutput?: JsonObject;
  memory?: MemoryRecall;
  readonly errors: TurnError[];
  readonly sets: MutSet[];
  liveness?: TurnLiveness;
  cache?: Cached<Turn>;
}

/** What a later event names before the log has shown it. */
type Held = (log: SessionLog) => boolean;

/** A session's events, folded incrementally (module header). */
export class SessionLog {
  private clock = 0;
  private readonly turns: MutTurn[] = [];
  private readonly turnsById = new Map<string, MutTurn>();
  private readonly items = new Map<string, MutItem>();
  private readonly setsById = new Map<string, MutSet>();
  private readonly seen = new Set<string>();
  private readonly held: Held[] = [];
  private readonly pendingOutput = new Map<string, string>();
  private readonly queued = new Map<string, QueuedMessage>();
  private queuedSnapshot: ReadonlyArray<QueuedMessage> = [];
  private status: SessionStatusView = { state: "idle", stopReason: "", waitingOn: [] };
  private lastSeq = 0n;
  private snapshotCache?: { clock: number; value: SessionFold };

  /** Folds stored events, in log order; returns whether anything changed. */
  apply(events: Iterable<SessionEvent>): boolean {
    const before = this.clock;
    for (const event of events) {
      this.applyEvent(event);
    }
    return this.clock !== before;
  }

  /** Folds one stream frame: a stored event or a live preview; returns whether anything changed. */
  applyFrame(frame: StreamSessionEventsResponse): boolean {
    const before = this.clock;
    switch (frame.frame.case) {
      case "event":
        this.applyEvent(frame.frame.value);
        break;
      case "eventStart": {
        const preview = frame.frame.value.event;
        if (preview !== undefined) {
          this.openDraft(preview.id, preview.type === "agent.thinking" ? "thinking" : "message");
        }
        break;
      }
      case "eventDelta": {
        const delta = frame.frame.value;
        const text = delta.delta?.content?.text ?? "";
        const draft = this.items.get(delta.eventId);
        if (draft !== undefined && draft.kind === "message" && draft.live && text !== "") {
          draft.text += text;
          this.touch(draft);
        }
        break;
      }
      case "stigmerToolOutputDelta": {
        const { toolUseId, delta } = frame.frame.value;
        const tool = this.items.get(toolUseId);
        if (tool === undefined) {
          this.pendingOutput.set(toolUseId, (this.pendingOutput.get(toolUseId) ?? "") + delta);
        } else if (tool.kind === "tool_use" && tool.result === undefined && delta !== "") {
          tool.liveOutput += delta;
          this.touch(tool);
        } else if (tool.kind === "tool_use" && tool.background !== undefined && tool.background.ended === undefined && delta !== "") {
          tool.background.liveOutput += delta;
          this.touch(tool);
        }
        break;
      }
      case "stigmerRunLiveness": {
        const liveness = frame.frame.value;
        const turn = this.turnsById.get(liveness.runId);
        if (turn !== undefined) {
          turn.liveness = {
            operations: liveness.operations.map((operation) => ({
              toolUseId: operation.toolUseId,
              name: operation.name,
              threadId: operation.threadId,
              elapsedMs: durationMs(operation.elapsed),
            })),
            awaitingModelMs: liveness.awaitingModelFor === undefined ? undefined : durationMs(liveness.awaitingModelFor),
          };
          this.touch(turn);
        }
        break;
      }
      default:
        break;
    }
    return this.clock !== before;
  }

  /** The fold as it stands: immutable, sharing every object no event touched since the last snapshot. */
  snapshot(): SessionFold {
    if (this.snapshotCache?.clock === this.clock) {
      return this.snapshotCache.value;
    }
    const previous = this.snapshotCache?.value;
    const turns = this.turns.map((turn, index) => this.snapTurn(turn, this.endedOf(turn, index)));
    const sameTurns =
      previous !== undefined &&
      previous.turns.length === turns.length &&
      previous.turns.every((turn, index) => turn === turns[index]);
    const value: SessionFold = {
      turns: sameTurns ? previous.turns : turns,
      queued: this.queuedSnapshot,
      status: this.status,
      lastSeq: this.lastSeq,
    };
    this.snapshotCache = { clock: this.clock, value };
    return value;
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  private applyEvent(event: SessionEvent): void {
    const e = event.event;
    if (e.case === undefined) {
      return;
    }
    if (event.seq > this.lastSeq) {
      this.lastSeq = event.seq;
      this.tick();
    }
    const id = e.value.id;
    if (e.case === "userMessage" && event.runId === "") {
      // A queued sighting: held until a run's copy replaces it (module header).
      if (!this.seen.has(id) && !this.queued.has(id)) {
        this.setQueued({ id, text: textOf(e.value.content), state: "waiting" });
      }
      return;
    }
    if (id !== "" && this.seen.has(id)) {
      return;
    }
    if (id !== "") {
      this.seen.add(id);
    }
    const at = e.value.processedAt;
    const runId = event.runId;
    switch (e.case) {
      case "userMessage": {
        if (this.queued.delete(id)) {
          this.queuedSnapshot = [...this.queued.values()];
          this.tick();
        }
        const turn = this.turnOf(runId);
        const text = textOf(e.value.content);
        if (turn.userMessage === undefined) {
          turn.userMessage = { id, text, processedAt: at };
          this.touch(turn);
        } else if (turn.items.length === 0) {
          const joined = [turn.userMessage.text, text].filter((each) => each !== "").join(MESSAGE_TEXT_SEPARATOR);
          turn.userMessage = { ...turn.userMessage, text: joined, joinedIds: [...(turn.userMessage.joinedIds ?? []), id] };
          this.touch(turn);
        } else {
          this.addText(event, "user_message", text);
        }
        break;
      }
      case "sessionStatusRunning":
        this.status = { state: "running", stopReason: "", waitingOn: [] };
        this.tick();
        break;
      case "sessionStatusIdle":
        this.status = {
          state: "idle",
          stopReason: e.value.stopReason?.type ?? "",
          waitingOn: [...(e.value.stopReason?.eventIds ?? [])],
        };
        this.tick();
        break;
      case "sessionError": {
        if (runId === "") {
          this.dropWaiting();
        }
        const turn = runId === "" ? this.turns.at(-1) : this.turnOf(runId);
        if (turn !== undefined) {
          turn.errors.push({ id, type: e.value.error?.type ?? "", message: e.value.error?.message ?? "", processedAt: at });
          this.touch(turn);
        }
        break;
      }
      case "agentMessage":
        this.addText(event, "message", textOf(e.value.content));
        break;
      case "agentThinking":
        this.addText(event, "thinking", "");
        break;
      case "stigmerAgentThinking": {
        const thinkingId = e.value.thinkingId;
        const text = e.value.text;
        this.whenItem(thinkingId, (item) => {
          if (item.kind === "thinking") {
            item.text = text;
            this.touch(item);
          }
        });
        break;
      }
      case "stigmerHarnessNote":
        this.addText(event, "note", e.value.text);
        break;
      case "agentThreadContextCompacted":
        this.addText(event, "compacted", "");
        break;
      case "agentToolUse":
        this.addTool(event, e.value.name, "", e.value.input ?? {}, e.value.evaluatedPermission);
        break;
      case "agentMcpToolUse":
        this.addTool(event, e.value.name, e.value.mcpServerName, e.value.input ?? {}, e.value.evaluatedPermission);
        break;
      case "agentToolResult":
        this.addResult(e.value.toolUseId, { id, text: textOf(e.value.content), isError: e.value.isError, processedAt: at });
        break;
      case "agentMcpToolResult":
        this.addResult(e.value.mcpToolUseId, { id, text: textOf(e.value.content), isError: e.value.isError, processedAt: at });
        break;
      case "stigmerPermissionAsked": {
        const ask: ToolAsk = {
          id,
          message: e.value.message,
          argsPreview: e.value.argsPreview,
          policySource: e.value.policySource,
          policyHook: e.value.policyHook,
          processedAt: at,
        };
        this.whenTool(e.value.toolUseId, (tool) => {
          tool.ask = ask;
        });
        break;
      }
      case "userToolConfirmation": {
        const confirmation: ToolConfirmation = {
          id,
          result: e.value.result === "deny" ? "deny" : "allow",
          denyMessage: e.value.denyMessage,
          processedAt: at,
        };
        this.whenTool(e.value.toolUseId, (tool) => {
          tool.confirmation = confirmation;
        });
        break;
      }
      case "stigmerPermissionGrant": {
        const lease = e.value.lease;
        const grant: PermissionGrant = {
          id,
          scope: e.value.scope,
          category: lease?.category ?? "",
          server: lease?.server ?? "",
          hook: lease?.hook,
          tool: lease?.tool ?? "",
          processedAt: at,
        };
        this.whenTool(e.value.toolUseId, (tool) => {
          tool.grant = grant;
        });
        break;
      }
      case "stigmerToolResultFullOutput": {
        const full: ToolFullOutput = {
          storageKey: e.value.storageKey,
          sizeBytes: e.value.sizeBytes,
          contentHash: e.value.contentHash,
          mimeType: e.value.mimeType,
          isImage: e.value.isImage,
        };
        this.whenTool(e.value.toolUseId, (tool) => {
          if (runId === tool.runId && isRunArtifact(tool.runId, full.storageKey)) {
            tool.fullOutput = full;
          }
        });
        break;
      }
      case "stigmerBackgroundCommandStatus": {
        const value = e.value;
        this.whenTool(value.toolUseId, (tool) => {
          const background = backgroundOf(tool);
          if (value.phase === "running") {
            background.timeoutSeconds = value.timeoutSeconds;
            background.startedAt = at;
            return;
          }
          if (background.ended !== undefined) {
            return;
          }
          background.startedAt ||= at;
          background.ended = {
            state: BACKGROUND_ENDINGS.has(value.ending) ? (value.ending as Exclude<BackgroundCommandState, "running">) : "stopped",
            exitCode: value.exitCode,
            stoppedBy: BACKGROUND_STOPPERS.has(value.stoppedBy) ? (value.stoppedBy as BackgroundStopper) : undefined,
            stoppedByToolUseId: value.stoppedByToolUseId,
            output: value.output,
            endedAt: value.endedAt,
          };
          background.liveOutput = "";
        });
        if (value.phase === "ended" && value.stoppedByToolUseId !== "") {
          const stopped = value.toolUseId;
          this.whenTool(value.stoppedByToolUseId, (stop) => {
            stop.stoppedBackground = stopped;
          });
        }
        break;
      }
      case "stigmerBackgroundCommandStopRequested":
        this.whenTool(e.value.toolUseId, (tool) => {
          backgroundOf(tool).stopRequested = true;
        });
        break;
      case "sessionThreadCreated": {
        const thread = this.threadOf(this.turnOf(runId), e.value.sessionThreadId);
        thread.agentName = e.value.agentName;
        this.touch(thread);
        break;
      }
      case "sessionThreadStatusRunning": {
        const thread = this.threadOf(this.turnOf(runId), e.value.sessionThreadId);
        thread.agentName ||= e.value.agentName;
        thread.state = "running";
        this.touch(thread);
        break;
      }
      case "agentThreadMessageSent": {
        const thread = this.threadOf(this.turnOf(runId), e.value.toSessionThreadId);
        thread.input = textOf(e.value.content);
        thread.agentName ||= e.value.toAgentName;
        this.touch(thread);
        break;
      }
      case "agentThreadMessageReceived": {
        const thread = this.threadOf(this.turnOf(runId), e.value.fromSessionThreadId);
        thread.reply = textOf(e.value.content);
        this.touch(thread);
        break;
      }
      case "sessionThreadStatusIdle": {
        const thread = this.threadOf(this.turnOf(runId), e.value.sessionThreadId);
        thread.state = e.value.stopReason?.type === "end_turn" ? "completed" : "failed";
        this.touch(thread);
        break;
      }
      case "stigmerAgentStructuredOutput": {
        const turn = this.turnOf(runId);
        turn.structuredOutput = e.value.output ?? {};
        this.touch(turn);
        break;
      }
      case "stigmerMemoryRecalled": {
        const turn = this.turnOf(runId);
        turn.memory = {
          selectionActive: e.value.selectionActive,
          injectedMemoryIds: [...e.value.injectedMemoryIds],
          embeddingModel: e.value.embeddingModel,
        };
        this.touch(turn);
        break;
      }
      case "stigmerRunStatus": {
        const turn = this.turnOf(runId);
        turn.status = {
          phase: e.value.phase as TurnPhase,
          stopCause: e.value.stopCause,
          error: e.value.error,
          processedAt: at,
        };
        this.touch(turn);
        break;
      }
      case "stigmerFileReviewChanges": {
        if (this.setsById.has(e.value.changeSetId)) {
          break;
        }
        const turn = this.turnOf(runId);
        const set: MutSet = {
          rev: 0,
          changeSetId: e.value.changeSetId,
          runId,
          changesEventId: id,
          aggregateDigest: e.value.aggregateDigest,
          files: e.value.files.map((file) => ({
            fileChangeId: file.fileChangeId,
            path: file.path,
            previousPath: file.previousPath,
            change: file.change,
            digest: file.digest,
            linesAdded: file.linesAdded,
            linesRemoved: file.linesRemoved,
            reviewable: file.reviewable,
          })),
          processedAt: at,
          decisions: [],
          reconciles: [],
        };
        this.setsById.set(set.changeSetId, set);
        turn.sets.push(set);
        this.touchSet(set);
        this.release();
        break;
      }
      case "stigmerFileReviewDecided": {
        const decision: FileReviewDecision = {
          id,
          scope: e.value.scope === "file" ? "file" : "change_set",
          fileChangeId: e.value.fileChangeId,
          action: e.value.action === "undo" ? "undo" : "keep",
          expectedDigest: e.value.expectedDigest,
          origin: e.value.origin,
          reason: e.value.reason,
          processedAt: at,
        };
        this.whenSet(e.value.changeSetId, (set) => {
          set.decisions.push(decision);
        });
        break;
      }
      case "stigmerFileReviewReconciled": {
        const value = e.value;
        // The turn that put the files back is a turn of its own (a
        // reconcile turn has no message); the outcome is the set's.
        this.turnOf(runId);
        this.whenSet(value.changeSetId, (set) => {
          const prefix = `${set.changesEventId}.r.`;
          set.reconciles.push({
            id,
            decidedEventId: id.startsWith(prefix) ? id.slice(prefix.length) : "",
            undonePaths: [...value.undonePaths],
            failure: value.failure,
            failureDetail: value.failureDetail,
            processedAt: at,
          });
        });
        break;
      }
      case "userInterrupt":
        // The turns it stopped say so in their own status; the messages
        // still waiting were dropped with them.
        this.dropWaiting();
        break;
      /* v8 ignore next 2 -- @preserve: every case the contract lands is handled above */
      default:
        break;
    }
  }

  // ── Building ───────────────────────────────────────────────────────────────

  private setQueued(message: QueuedMessage): void {
    this.queued.set(message.id, message);
    this.queuedSnapshot = [...this.queued.values()];
    this.tick();
  }

  /** Marks every waiting queued message dropped (module header). */
  private dropWaiting(): void {
    const waiting = [...this.queued.values()].filter((message) => message.state === "waiting");
    for (const message of waiting) {
      this.queued.set(message.id, { ...message, state: "dropped" });
    }
    if (waiting.length > 0) {
      this.queuedSnapshot = [...this.queued.values()];
      this.tick();
    }
  }

  private tick(): void {
    this.clock += 1;
  }

  /** Marks a node, and every node that holds it, changed. */
  private touch(node: MutItem | MutThread | MutTurn): void {
    this.tick();
    let at: MutItem | MutThread | MutTurn | undefined = node;
    while (at !== undefined) {
      at.rev = this.clock;
      at = at.kind === "turn" ? undefined : at.kind === "thread" ? at.turn : at.owner;
    }
  }

  private touchSet(set: MutSet): void {
    this.tick();
    set.rev = this.clock;
    const turn = this.turnsById.get(set.runId);
    if (turn !== undefined) {
      this.touch(turn);
    }
  }

  private turnOf(runId: string): MutTurn {
    let turn = this.turnsById.get(runId);
    if (turn === undefined) {
      turn = {
        kind: "turn",
        rev: 0,
        runId,
        items: [],
        threads: new Map(),
        todos: new Map(),
        errors: [],
        sets: [],
      };
      this.turnsById.set(runId, turn);
      this.turns.push(turn);
      this.touch(turn);
    }
    return turn;
  }

  private threadOf(turn: MutTurn, threadId: string): MutThread {
    let thread = turn.threads.get(threadId);
    if (thread === undefined) {
      thread = { kind: "thread", rev: 0, id: threadId, turn, agentName: "", input: "", reply: "", state: "running", items: [] };
      turn.threads.set(threadId, thread);
      this.touch(thread);
    }
    return thread;
  }

  /** The list an event's item belongs to: its thread's, or the turn's primary thread. */
  private ownerOf(runId: string, threadId: string): MutThread | MutTurn {
    const turn = this.turnOf(runId);
    return threadId === "" ? turn : this.threadOf(turn, threadId);
  }

  private addText(event: SessionEvent, kind: MutText["kind"], text: string): void {
    const value = event.event.value!;
    const existing = this.items.get(value.id);
    if (existing !== undefined && existing.kind === kind && existing.live) {
      // The stored event replaces its live preview, in place.
      existing.text = kind === "thinking" && text === "" ? existing.text : text;
      existing.live = false;
      existing.processedAt = value.processedAt;
      this.touch(existing);
      this.release();
      return;
    }
    const owner = this.ownerOf(event.runId, event.threadId);
    const item: MutText = { kind, rev: 0, id: value.id, text, live: false, processedAt: value.processedAt, owner };
    owner.items.push(item);
    this.items.set(item.id, item);
    this.touch(item);
    this.release();
  }

  private addTool(event: SessionEvent, name: string, mcpServerName: string, input: JsonObject, permission: string): void {
    const value = event.event.value!;
    const owner = this.ownerOf(event.runId, event.threadId);
    const tool: MutTool = {
      kind: "tool_use",
      rev: 0,
      id: value.id,
      runId: event.runId,
      threadId: event.threadId,
      name,
      mcpServerName,
      input,
      evaluatedPermission: permission,
      processedAt: value.processedAt,
      owner,
      liveOutput: this.pendingOutput.get(value.id) ?? "",
    };
    this.pendingOutput.delete(value.id);
    owner.items.push(tool);
    this.items.set(tool.id, tool);
    this.touch(tool);
    this.release();
  }

  private addResult(toolUseId: string, result: ToolResult): void {
    this.whenTool(toolUseId, (tool) => {
      tool.result = result;
      tool.liveOutput = "";
      const turn = this.turnsById.get(tool.runId);
      if (
        turn !== undefined &&
        tool.threadId === "" &&
        tool.mcpServerName === "" &&
        !result.isError &&
        isTodoTool(tool.name)
      ) {
        applyTodoUpdate(turn.todos, tool.input["todos"], { merge: tool.input["merge"] === true, now: result.processedAt });
        this.touch(turn);
      }
    });
  }

  /** Opens a live preview under the id its stored event will carry (module header, "Previews"). */
  private openDraft(id: string, kind: "message" | "thinking"): void {
    if (this.seen.has(id) || this.items.has(id)) {
      return;
    }
    const place = previewPlaceOf(id);
    if (place === undefined) {
      return;
    }
    const owner = this.ownerOf(place.runId, place.threadId);
    const item: MutText = { kind, rev: 0, id, text: "", live: true, processedAt: "", owner };
    owner.items.push(item);
    this.items.set(id, item);
    this.touch(item);
  }

  private whenItem(id: string, apply: (item: MutItem) => void): void {
    const run = (log: SessionLog): boolean => {
      const item = log.items.get(id);
      if (item === undefined || (item.kind !== "tool_use" && item.live)) {
        return false;
      }
      apply(item);
      log.touch(item);
      return true;
    };
    if (!run(this)) {
      this.held.push(run);
    }
  }

  private whenTool(id: string, apply: (tool: MutTool) => void): void {
    this.whenItem(id, (item) => {
      if (item.kind === "tool_use") {
        apply(item);
      }
    });
  }

  private whenSet(changeSetId: string, apply: (set: MutSet) => void): void {
    const run = (log: SessionLog): boolean => {
      const set = log.setsById.get(changeSetId);
      if (set === undefined) {
        return false;
      }
      apply(set);
      log.touchSet(set);
      return true;
    };
    if (!run(this)) {
      this.held.push(run);
    }
  }

  /** Applies whatever was held for something the log has now shown. */
  private release(): void {
    if (this.held.length === 0) {
      return;
    }
    const waiting = this.held.splice(0);
    for (const run of waiting) {
      if (!run(this)) {
        this.held.push(run);
      }
    }
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────

  /** Whether a turn has ended (module header, "A turn's end"). */
  private endedOf(turn: MutTurn, index: number): boolean {
    if (turn.status !== undefined) {
      return TURN_ENDED_PHASES.has(turn.status.phase);
    }
    if (index < this.turns.length - 1) {
      return true;
    }
    if (this.status.state !== "idle" || this.status.stopReason === "") {
      return false;
    }
    if (this.status.stopReason !== "requires_action") {
      return true;
    }
    const waiting = new Set(this.status.waitingOn);
    return ![...this.items.values()].some((item) => item.kind === "tool_use" && item.runId === turn.runId && waiting.has(item.id));
  }

  private snapTurn(turn: MutTurn, ended: boolean): Turn {
    const key = `${turn.rev}|${ended}`;
    if (turn.cache?.key === key) {
      return turn.cache.value;
    }
    const asks: ToolUse[] = [];
    const items = turn.items.map((item) => this.snapItem(item, ended, asks));
    const lastMessage = [...items].reverse().find((item): item is MessageItem => item.kind === "message" && !item.live);
    const value: Turn = {
      runId: turn.runId,
      userMessage: turn.userMessage,
      items: sameList(turn.cache?.value.items, items),
      status: turn.status,
      ended,
      asks: sameList(turn.cache?.value.asks, asks),
      todos: [...turn.todos.values()],
      structuredOutput: turn.structuredOutput,
      memory: turn.memory,
      fileReview: turn.sets.map((set) => this.snapSet(set)),
      errors: [...turn.errors],
      answer: lastMessage?.text ?? "",
      liveness: ended ? undefined : this.openLiveness(turn.liveness),
    };
    turn.cache = { key, value };
    return value;
  }

  /** A turn's liveness less the operations whose result the log already holds: a result touches the turn, so this re-reads. */
  private openLiveness(liveness: TurnLiveness | undefined): TurnLiveness | undefined {
    if (liveness === undefined) {
      return undefined;
    }
    const operations = liveness.operations.filter((operation: TurnOpenOperation) => {
      const item = this.items.get(operation.toolUseId);
      return item === undefined || item.kind !== "tool_use" || item.result === undefined;
    });
    return operations.length === liveness.operations.length ? liveness : { ...liveness, operations };
  }

  private snapItem(item: MutItem, ended: boolean, asks: ToolUse[]): TurnItem {
    if (item.kind !== "tool_use") {
      if (item.cache?.key === `${item.rev}`) {
        return item.cache.value;
      }
      const value = textItemOf(item);
      item.cache = { key: `${item.rev}`, value };
      return value;
    }
    const turn = item.owner.kind === "thread" ? item.owner.turn : item.owner;
    const sub = turn.threads.get(item.id);
    const threadAsks: ToolUse[] = [];
    const snappedThread = sub === undefined ? undefined : this.snapThread(sub, ended, threadAsks);
    const key = `${item.rev}|${ended}|${sub?.rev ?? -1}`;
    let value: ToolUse;
    if (item.cache?.key === key) {
      value = item.cache.value;
    } else {
      value = {
        kind: "tool_use",
        id: item.id,
        runId: item.runId,
        threadId: item.threadId,
        name: item.name,
        mcpServerName: item.mcpServerName,
        input: item.input,
        evaluatedPermission: item.evaluatedPermission,
        state: toolStateOf(item, ended),
        ask: item.ask,
        confirmation: item.confirmation,
        grant: item.grant,
        result: item.result,
        fullOutput: item.fullOutput,
        liveOutput: item.liveOutput,
        background: backgroundViewOf(item.background, ended),
        stoppedBackground: this.stoppedBackgroundOf(item),
        thread: snappedThread,
        processedAt: item.processedAt,
      };
      item.cache = { key, value };
    }
    if (value.state === "waiting") {
      asks.push(value);
    }
    asks.push(...threadAsks);
    return value;
  }

  /** The command a stop call stopped, with its starting call's input (which never changes once logged). */
  private stoppedBackgroundOf(item: MutTool): StoppedBackgroundCommand | undefined {
    if (item.stoppedBackground === undefined) {
      return undefined;
    }
    const command = this.items.get(item.stoppedBackground);
    return { toolUseId: item.stoppedBackground, input: command?.kind === "tool_use" ? command.input : {} };
  }

  private snapThread(thread: MutThread, ended: boolean, asks: ToolUse[]): Thread {
    const items = thread.items.map((item) => this.snapItem(item, ended, asks));
    const key = `${thread.rev}|${ended}`;
    if (thread.cache?.key === key) {
      return thread.cache.value;
    }
    const value: Thread = {
      id: thread.id,
      agentName: thread.agentName,
      input: thread.input,
      reply: thread.reply,
      state: thread.state === "running" && ended ? "stopped" : thread.state,
      items: sameList(thread.cache?.value.items, items),
    };
    thread.cache = { key, value };
    return value;
  }

  private snapSet(set: MutSet): FileReviewSet {
    const key = `${set.rev}`;
    if (set.cache?.key === key) {
      return set.cache.value;
    }
    const files = fileStatesOf(set);
    const value: FileReviewSet = {
      changeSetId: set.changeSetId,
      runId: set.runId,
      aggregateDigest: set.aggregateDigest,
      files,
      decisions: [...set.decisions],
      reconciles: set.reconciles.map(({ decidedEventId: _decided, ...reconcile }) => reconcile),
      undecided: files.some((file) => file.state === "undecided"),
      processedAt: set.processedAt,
    };
    set.cache = { key, value };
    return value;
  }
}

/** Folds a whole list of events at once. */
export function foldSession(events: Iterable<SessionEvent>): SessionFold {
  const log = new SessionLog();
  log.apply(events);
  return log.snapshot();
}

/** A turn of the fold, by its run id. */
export function turnOf(fold: SessionFold, runId: string): Turn | undefined {
  return fold.turns.find((turn) => turn.runId === runId);
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** The text blocks of a content list, joined. */
export function textOf(content: ReadonlyArray<ContentBlock>): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Where a preview belongs, read from the id the runner derived for its
 * stored event (`<run>.<scope>.m<index>` or `.t<index>`; the runner's
 * harness/events/ids.ts): the run, and the thread (`<run>.<scope>`, or ""
 * for the root scope). Undefined for an id of any other shape.
 */
export function previewPlaceOf(id: string): { readonly runId: string; readonly threadId: string } | undefined {
  const match = /^([^.]+)\.(.+)\.[mt]\d+$/.exec(id);
  if (match === null) {
    return undefined;
  }
  const runId = match[1]!;
  const scope = match[2]!;
  return { runId, threadId: scope === "root" ? "" : `${runId}.${scope}` };
}

/** A duration in milliseconds; an unset one is zero. */
function durationMs(duration: Duration | undefined): number {
  if (duration === undefined) {
    return 0;
  }
  return Number(duration.seconds) * 1000 + Math.floor(duration.nanos / 1_000_000);
}

function textItemOf(item: MutText): TurnItem {
  switch (item.kind) {
    case "message":
      return { kind: "message", id: item.id, text: item.text, live: item.live, processedAt: item.processedAt } satisfies MessageItem;
    case "thinking":
      return { kind: "thinking", id: item.id, text: item.text, live: item.live, processedAt: item.processedAt } satisfies ThinkingItem;
    case "note":
      return { kind: "note", id: item.id, text: item.text, processedAt: item.processedAt } satisfies NoteItem;
    case "compacted":
      return { kind: "compacted", id: item.id, processedAt: item.processedAt } satisfies CompactedItem;
    case "user_message":
      return { kind: "user_message", id: item.id, text: item.text, processedAt: item.processedAt } satisfies UserMessageItem;
  }
}

/** Whether a storage key lies inside one run's artifacts: `artifacts/<run>/...`, with no empty, `.` or `..` segment. */
function isRunArtifact(runId: string, storageKey: string): boolean {
  const segments = storageKey.split("/");
  return (
    segments.length > 2 &&
    segments[0] === "artifacts" &&
    segments[1] === runId &&
    segments.every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** A tool use's state (types.ts `ToolUseState`). */
function toolStateOf(tool: MutTool, ended: boolean): ToolUseState {
  if (tool.confirmation?.result === "deny" || tool.evaluatedPermission === "deny") {
    return "denied";
  }
  if (tool.result !== undefined) {
    return tool.result.isError ? "failed" : "completed";
  }
  if (ended) {
    return "stopped";
  }
  if (tool.evaluatedPermission === "ask" && tool.confirmation === undefined) {
    return "waiting";
  }
  return "running";
}

/** A tool use's background command, made when the log first names it. */
function backgroundOf(tool: MutTool): MutBackground {
  tool.background ??= { timeoutSeconds: 0, startedAt: "", liveOutput: "", stopRequested: false };
  return tool.background;
}

/** A background command as a client reads it (types.ts `BackgroundCommandView`); `turnEnded` stops one that never ended. */
function backgroundViewOf(background: MutBackground | undefined, turnEnded: boolean): BackgroundCommandView | undefined {
  if (background === undefined) {
    return undefined;
  }
  const ended = background.ended;
  if (ended !== undefined) {
    return {
      state: ended.state,
      timeoutSeconds: background.timeoutSeconds,
      exitCode: ended.exitCode,
      stoppedBy: ended.stoppedBy,
      stoppedByToolUseId: ended.stoppedByToolUseId,
      output: ended.output,
      startedAt: background.startedAt,
      endedAt: ended.endedAt,
      liveOutput: "",
      stopRequested: background.stopRequested,
    };
  }
  return {
    state: turnEnded ? "stopped" : "running",
    timeoutSeconds: background.timeoutSeconds,
    exitCode: undefined,
    stoppedBy: turnEnded ? "turn" : undefined,
    stoppedByToolUseId: "",
    output: turnEnded ? background.liveOutput : "",
    startedAt: background.startedAt,
    endedAt: "",
    liveOutput: turnEnded ? "" : background.liveOutput,
    stopRequested: background.stopRequested,
  };
}

/** Whether a tool use's background command is running now: the one test every reader uses. */
export function isBackgroundRunning(tool: Pick<ToolUse, "background">): boolean {
  return tool.background?.state === "running";
}

/** Each file's state, from the set's decisions and reconciles in log order. */
function fileStatesOf(set: MutSet): FileReviewFile[] {
  const last = new Map<string, FileReviewDecision>();
  for (const decision of set.decisions) {
    if (decision.scope === "change_set") {
      for (const file of set.files) {
        last.set(file.fileChangeId, decision);
      }
    } else {
      last.set(decision.fileChangeId, decision);
    }
  }
  const reconciled = new Map(set.reconciles.map((r) => [r.decidedEventId, r]));
  return set.files.map((file) => {
    const decision = last.get(file.fileChangeId);
    let state: FileReviewFile["state"] = "undecided";
    if (decision?.action === "keep") {
      state = "kept";
    } else if (decision?.action === "undo") {
      const outcome = reconciled.get(decision.id);
      state = outcome === undefined ? "undoing" : outcome.failure === "" ? "undone" : "undo_failed";
    }
    return { ...file, state, decidedBy: decision?.origin ?? "" };
  });
}

/** The previous list when every element is the same object; the new one otherwise. */
function sameList<T>(previous: ReadonlyArray<T> | undefined, next: T[]): ReadonlyArray<T> {
  if (previous !== undefined && previous.length === next.length && previous.every((value, index) => value === next[index])) {
    return previous;
  }
  return next;
}
