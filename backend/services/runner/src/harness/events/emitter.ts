/**
 * SessionEventEmitter: writes what the agent did into its session's event
 * log (`SessionCommandController.appendEvents`), in Claude Managed Agents'
 * events, from the rows the turn's status already holds.
 *
 * Where it reads. The persist chokepoint calls {@link flush} on every write
 * of the status, after the secret backstop and the tool-output offload of
 * that write and before the status itself is sent (`persist-chokepoint.ts`),
 * so the log sees exactly what the status carries, redacted and bounded,
 * in both process modes (the agent host's rows reach this status on every
 * persist). One reader of the rows, never a second writer of them.
 *
 * What it writes: only sealed facts, in order. Each thread (the root, or
 * one sub-agent) is walked in its rows' order: per message, the message,
 * then its tool uses, then their results. A `task` call's use opens its
 * sub-agent's thread; its result follows the thread's idle. The emitter
 * writes the longest sealed prefix of each thread's walk and never a fact
 * past an unsealed one, so the log is in order within a thread and parallel
 * sub-agents interleave as they run. Sealed means no later step can
 * rewrite it:
 *   - a message, once it stops streaming (an empty one writes nothing);
 *   - a tool use, once it is known to run or to ask: at start on a harness
 *     whose boundary never rewrites a row, and on one that does (Cursor,
 *     the `boundaryRewritesRow` capability) once the row is beyond the
 *     boundary's reach or the turn's terminal write proves the boundary ran;
 *   - a tool result, once its row settles, with the same boundary rule;
 *   - a hidden row (the collapsed shape) writes nothing.
 * A result whose output the chokepoint offloaded carries the output's
 * head, and `stigmer.tool_result.full_output` after it says where the
 * whole output is stored.
 * So narration a boundary later blanks sits behind an unsealed row and
 * reaches neither the log nor a preview.
 *
 * File review. A change set the turn captured (a CANDIDATE_CAPTURED on the
 * run's own ledger, `status.file_review_event_stream`) is written as one
 * `stigmer.file_review.changes`, read from that ledger at the same
 * chokepoint, once. The undo a turn's start does for an earlier turn
 * (`harness/owed-undos.ts`) is written as `stigmer.file_review.reconciled`
 * through {@link writeReconciled}, at once, before the engine's turn begins
 * and before the workspace lock is released. A decision is never the
 * runner's to write: `stigmer.file_review.decided` is the server's.
 *
 * Which rows are its to write. Seeded SYSTEM rows never are (the server's
 * stop rows, or notes an earlier invocation wrote); the rows a terminal arm
 * appends are reported ({@link skipRootRows}) and skipped, because the
 * session's status events and the run's stop cause say it; every other
 * SYSTEM row is a note of the harness (`stigmer.harness.note`).
 *
 * Its memory is the log. A resumed or retried turn first lists its run's
 * events ({@link begin}) and treats those ids as sent, so it resends
 * nothing whatever later edits did to the rows; a fresh turn skips the
 * read. Ids are derived (`ids.ts`), so a fact is named the same way by
 * every invocation.
 *
 * Previews. The transcript builder's observer hands every token delta to
 * {@link observe}; the previews ride the next append. A message is
 * previewed only while its thread's sealed prefix has reached it, and one
 * whose previews were ever held back is never previewed again (a partial
 * preview would show a client half a sentence).
 *
 * Failure. A transient append failure is retried; if it still fails the
 * events stay queued for the next write, whose status write goes ahead
 * (STOP and the heartbeat ride it). A refusal is a runner defect: the batch
 * is logged with its ids and dropped, so one bad event cannot wedge a turn.
 * The terminal write retries the queue once more and then logs the loss.
 *
 * Proven by `__tests__/emitter.test.ts` and the hermetic event goldens.
 */

import { create, toBinary } from "@bufbuild/protobuf";
import type { JsonObject, MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalPolicySource,
  FileChangeKind,
  FileReviewBlockReason,
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import type { SubAgentRun } from "@stigmer/protos/ai/stigmer/agentic/run/v1/subagent_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { SessionEventPreviewSchema, type SessionEventPreview } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

import type { StigmerClient } from "../../client/stigmer-client.js";
import type { ReconciledUndo } from "../owed-undos.js";
import { elideToEncodedSize } from "../../shared/status-offload.js";
import { isToolCallRowHidden } from "../../shared/tool-row.js";
import type { TranscriptEvent } from "../transcript/events.js";
import {
  fileReviewChangesEventId,
  fileReviewReconciledEventId,
  harnessNoteEventId,
  memoryRecalledEventId,
  messageEventId,
  permissionAskedEventId,
  scopeEventPrefix,
  structuredOutputEventId,
  thinkingEventId,
  thinkingTextEventId,
  threadEventId,
  threadId,
  toolResultEventId,
  toolResultFullOutputEventId,
  toolUseEventId,
} from "./ids.js";

/** The most bytes one encoded event may hold: the session log's own cap (the server's `SESSION_EVENT_MAX_BYTES`). */
export const SESSION_EVENT_MAX_BYTES = 256 * 1024;

/** The most events one append carries (`AppendSessionEventsInput.events`). */
const APPEND_MAX_EVENTS = 1000;

/** The most event bytes one append carries: well under the transport's message limit. */
const APPEND_MAX_BYTES = 4 * 1024 * 1024;

/** Transient append failures retried within one write, with this backoff. */
const APPEND_RETRIES = 3;
const APPEND_RETRY_BASE_MS = 200;

/** The append codes that are the runner's defect, never the network's: the batch is dropped. */
const REFUSAL_CODES: ReadonlySet<Code> = new Set([
  Code.InvalidArgument,
  Code.AlreadyExists,
  Code.FailedPrecondition,
  Code.PermissionDenied,
  Code.NotFound,
  Code.Unimplemented,
]);

export interface SessionEventEmitterDeps {
  readonly client: Pick<StigmerClient, "appendSessionEvents" | "listRunSessionEvents">;
  readonly runId: string;
  /** The credential the append presents, as the values fetch acquires it; read once, at the first append. */
  readonly credential: () => Promise<string | undefined>;
  /** The harness's `boundaryRewritesRow` capability; absent when its boundary never rewrites a row. */
  readonly boundaryRewritesRow?: (row: ToolCall) => boolean;
  /** Waits between transient retries; the tests pass an immediate one. */
  readonly delay?: (ms: number) => Promise<void>;
}

/** Where one fold left a delta's row: its place in its scope's message array. */
export interface ObservedPlace {
  readonly messageIndex: number;
}

/** What a thread's walk reached: an unsealed message (still streaming), the end of its rows, or a blocking row. */
type Frontier =
  | { readonly kind: "message"; readonly index: number }
  | { readonly kind: "end"; readonly nextIndex: number }
  | { readonly kind: "blocked" };

type EventValue = MessageInitShape<typeof SessionEventSchema>["event"];

/** One thread's rows as the walk reads them. */
interface Thread {
  /** The scope's sub-agent id; absent for the root. */
  readonly subAgentId?: string;
  /** The thread's id in the log; "" for the root. */
  readonly threadId: string;
  readonly prefix: string;
  readonly messages: readonly AgentMessage[];
}

/** A preview the observer queued, decided at the next flush. */
type PendingPreview =
  | { readonly kind: "text"; readonly subAgentId?: string; readonly index: number; readonly text: string }
  | { readonly kind: "thinking"; readonly subAgentId?: string; readonly index: number }
  | { readonly kind: "tool-output"; readonly callId: string; readonly delta: string };

/**
 * The ask's policy source as the log's word, the enum value without its
 * prefix. Typed over every value, so a new source fails the build until
 * it has a word, and the event's validation lists the same words.
 */
export const POLICY_SOURCE_WORDS: Readonly<Record<ApprovalPolicySource, string>> = {
  [ApprovalPolicySource.UNSPECIFIED]: "",
  [ApprovalPolicySource.AUTO_APPROVE_ALL]: "auto_approve_all",
  [ApprovalPolicySource.APPROVAL_LEASE]: "approval_lease",
  [ApprovalPolicySource.BUILTIN_CATEGORY]: "builtin_category",
  [ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN]: "annotation_destructive_tighten",
  [ApprovalPolicySource.UNATTENDED_SKIP]: "unattended_skip",
  [ApprovalPolicySource.HOOK]: "hook",
};

/** A ledger change kind as the log's word (`stigmer.file_review.changes`): a binary change is a modification. */
export const FILE_CHANGE_WORDS: Readonly<Record<FileChangeKind, string>> = {
  [FileChangeKind.UNSPECIFIED]: "modified",
  [FileChangeKind.ADD]: "added",
  [FileChangeKind.MODIFY]: "modified",
  [FileChangeKind.DELETE]: "deleted",
  [FileChangeKind.RENAME]: "renamed",
  [FileChangeKind.BINARY_CHANGE]: "modified",
};

/** How much of a captured change can be shown, as the log's word. */
export function reviewableWord(change: CapturedFileChange): string {
  if (change.diffComplete) return "complete";
  if (change.blockedReason === FileReviewBlockReason.SECRET_WITHHELD) return "secret";
  if (change.before?.isBinary === true || change.after?.isBinary === true) return "binary";
  return "partial";
}

export class SessionEventEmitter {
  private began = false;
  /** Ids the log holds, or that were dropped as refused: never sent again. */
  private readonly sent = new Set<string>();
  /** Built and awaiting an append that succeeds, in order. */
  private queue: SessionEvent[] = [];
  private readonly queued = new Set<string>();
  private pendingPreviews: PendingPreview[] = [];
  /** Previewed message ids already opened with an event_start. */
  private readonly previewStarted = new Set<string>();
  /** Message ids never to preview again (their previews were held back once). */
  private readonly previewWithheld = new Set<string>();
  /** Per scope (root ""), how many messages the reinvocation seeded: their SYSTEM rows are not this turn's to write. */
  private readonly seeded = new Map<string, number>();
  /** Root positions of the rows a terminal arm appended. */
  private readonly armRows = new Set<number>();
  /** Per scope (root ""), where its last walk stopped. */
  private readonly frontiers = new Map<string, Frontier>();
  /** The sub-agent threads of the write being read, by sub-agent id. */
  private threads = new Map<string, Thread>();
  private token: Promise<string | undefined> | undefined;
  private lost = 0;

  constructor(private readonly deps: SessionEventEmitterDeps) {}

  /**
   * Start writing: record what the reinvocation seeded, and on a resumed or
   * retried turn read back what this run already wrote. Before this call
   * every flush writes nothing, and the rows wait for the first flush after
   * it. A failed read is logged and the turn writes on: what it resends
   * with the same bytes the log accepts again, and anything else is
   * refused and dropped, never fatal.
   */
  async begin(args: { readonly sessionId: string; readonly resumed: boolean; readonly status: RunStatus }): Promise<void> {
    this.seeded.set("", args.status.messages.length);
    for (const row of args.status.subAgentRuns) this.seeded.set(row.id, row.messages.length);
    if (args.resumed) {
      try {
        for (const event of await this.deps.client.listRunSessionEvents(args.sessionId, this.deps.runId)) {
          if (event.event.case !== undefined) this.sent.add(event.event.value.id);
        }
      } catch (err) {
        console.warn(`[session-events] run=${this.deps.runId}: reading what the run already wrote failed; writing on: ${String(err)}`);
      }
    }
    this.began = true;
  }

  /** The root positions of rows a terminal arm appended: never written (the module header). */
  skipRootRows(indices: readonly number[]): void {
    for (const index of indices) this.armRows.add(index);
  }

  /**
   * A folded transcript event, for previews. `place` is where the fold left
   * a delta's row (absent for a fact with no row of its own).
   */
  observe(event: TranscriptEvent, place?: ObservedPlace): void {
    switch (event.kind) {
      case "text_delta":
        if (place !== undefined && event.text !== "") {
          this.pendingPreviews.push({ kind: "text", subAgentId: event.subAgentId, index: place.messageIndex, text: event.text });
        }
        return;
      case "reasoning_delta":
        if (place !== undefined) this.pendingPreviews.push({ kind: "thinking", subAgentId: event.subAgentId, index: place.messageIndex });
        return;
      case "tool_output_delta":
        if (event.delta !== "") this.pendingPreviews.push({ kind: "tool-output", callId: event.callId, delta: event.delta });
        return;
      default:
        return;
    }
  }

  /**
   * One write's events: what sealed since the last, then the append, before
   * the status write that follows it. `final` is the turn's terminal write:
   * every row is past the boundary and nothing streams. Never throws.
   */
  async flush(status: RunStatus, opts: { readonly final: boolean }): Promise<void> {
    if (!this.began) return;
    try {
      this.collect(status, opts.final);
    } catch (err) {
      console.error(`[session-events] run=${this.deps.runId}: reading the rows failed: ${String(err)}`);
    }
    const previews = this.decidePreviews(opts.final);
    if (this.queue.length === 0 && previews.length === 0) return;
    await this.append(previews, opts.final);
  }

  // ── Reading the rows ──────────────────────────────────────────────────────

  private collect(status: RunStatus, final: boolean): void {
    const runId = this.deps.runId;
    const report = status.recalledMemoriesReport;
    if (report !== undefined) {
      this.push("", memoryRecalledEventId(runId), {
        case: "stigmerMemoryRecalled",
        value: {
          id: memoryRecalledEventId(runId),
          selectionActive: report.selectionActive,
          injectedMemoryIds: [...report.injectedMemoryIds],
          embeddingModel: report.embeddingModel,
        },
      });
    }

    const subAgents = new Map(status.subAgentRuns.map((row) => [row.id, row]));
    this.threads = new Map(
      status.subAgentRuns.map((row) => [
        row.id,
        { subAgentId: row.id, threadId: threadId(runId, row.id), prefix: scopeEventPrefix(runId, row.id), messages: row.messages },
      ]),
    );
    const threads: Thread[] = [
      { threadId: "", prefix: scopeEventPrefix(runId, undefined), messages: status.messages },
      ...this.threads.values(),
    ];
    // A sub-agent's thread is walked where it opens and again where it
    // closes, inside its parent's walk; one more pass over every thread
    // catches what an earlier thread's walk unblocked, until nothing new.
    for (let pass = 0; pass <= threads.length; pass++) {
      const before = this.queue.length;
      for (const thread of threads) this.walk(thread, subAgents, final);
      if (this.queue.length === before) break;
    }

    this.collectFileReviewChanges(status);

    if (status.structuredOutput !== undefined && this.frontiers.get("")?.kind === "end" && final) {
      this.push("", structuredOutputEventId(runId), {
        case: "stigmerAgentStructuredOutput",
        value: { id: structuredOutputEventId(runId), output: status.structuredOutput },
      });
    }
  }

  /** One `stigmer.file_review.changes` per change set the run's own ledger captured (the module header). */
  private collectFileReviewChanges(status: RunStatus): void {
    for (const event of status.fileReviewEventStream?.events ?? []) {
      if (event.payload.case !== "candidateCaptured") continue;
      const candidate = event.payload.value;
      const id = fileReviewChangesEventId(candidate.changeSetId);
      this.push("", id, {
        case: "stigmerFileReviewChanges",
        value: {
          id,
          changeSetId: candidate.changeSetId,
          files: candidate.changes.map((change) => ({
            fileChangeId: change.id,
            path: change.pathAfter || change.pathBefore,
            previousPath: change.kind === FileChangeKind.RENAME ? change.pathBefore : "",
            change: FILE_CHANGE_WORDS[change.kind],
            digest: change.fileDigest,
            linesAdded: change.linesAdded,
            linesRemoved: change.linesRemoved,
            reviewable: reviewableWord(change),
          })),
          aggregateDigest: candidate.aggregateDigest,
        },
      });
    }
  }

  /**
   * Write what a turn's start put back for earlier turns, one
   * `stigmer.file_review.reconciled` per change set, at once: whether or not
   * the engine's turn has begun (a reconcile turn never begins one), and
   * before the caller releases the workspace lock, so the next holder of the
   * tree reads it and does not undo the same files again. Retried as a
   * terminal write is; a loss is logged, never thrown. An outcome the log
   * already holds is not sent again.
   */
  async writeReconciled(answers: readonly ReconciledUndo[]): Promise<void> {
    for (const outcome of answers) {
      const id = fileReviewReconciledEventId(outcome.changeSetId, outcome.decidedEventId);
      this.push("", id, {
        case: "stigmerFileReviewReconciled",
        value: {
          id,
          changeSetId: outcome.changeSetId,
          undonePaths: [...outcome.undonePaths],
          failure: outcome.failure,
          failureDetail: outcome.failureDetail,
        },
      });
    }
    if (this.queue.length === 0) return;
    await this.append([], true);
  }

  /** One thread's sealed prefix, from its start, skipping what is already sent or queued. */
  private walk(thread: Thread, subAgents: ReadonlyMap<string, SubAgentRun>, final: boolean): void {
    const scope = thread.subAgentId ?? "";
    if (thread.subAgentId !== undefined && !this.known(threadEventId(thread.threadId, "created"))) {
      // A thread is written only once the root wrote its creation.
      this.frontiers.set(scope, { kind: "blocked" });
      return;
    }
    const seeded = this.seeded.get(scope) ?? 0;
    for (let index = 0; index < thread.messages.length; index++) {
      const message = thread.messages[index]!;
      if (!this.writeMessage(thread, message, index, seeded, final)) {
        this.frontiers.set(scope, { kind: "message", index });
        return;
      }
      for (const row of message.toolCalls) {
        if (!this.writeToolUse(thread, row, subAgents, final)) {
          this.frontiers.set(scope, { kind: "blocked" });
          return;
        }
      }
      for (const row of message.toolCalls) {
        if (!this.writeToolResult(thread, row, subAgents, final)) {
          this.frontiers.set(scope, { kind: "blocked" });
          return;
        }
      }
    }
    this.frontiers.set(scope, { kind: "end", nextIndex: thread.messages.length });
  }

  /** The message's events, or false when it still streams. */
  private writeMessage(thread: Thread, message: AgentMessage, index: number, seeded: number, final: boolean): boolean {
    switch (message.type) {
      case MessageType.MESSAGE_AI: {
        if (message.isStreaming && !final) return false;
        if (message.content === "") return true;
        const id = messageEventId(thread.prefix, index);
        this.push(thread.threadId, id, { case: "agentMessage", value: { id, content: [{ type: "text", text: message.content }] } });
        return true;
      }
      case MessageType.MESSAGE_THINKING: {
        if (message.isStreaming && !final) return false;
        const id = thinkingEventId(thread.prefix, index);
        this.push(thread.threadId, id, { case: "agentThinking", value: { id } });
        const textId = thinkingTextEventId(id);
        this.push(thread.threadId, textId, { case: "stigmerAgentThinking", value: { id: textId, thinkingId: id, text: message.content } });
        return true;
      }
      case MessageType.MESSAGE_SYSTEM: {
        if (index < seeded) return true;
        if (thread.subAgentId === undefined && this.armRows.has(index)) return true;
        const id = harnessNoteEventId(thread.prefix, index);
        this.push(thread.threadId, id, { case: "stigmerHarnessNote", value: { id, text: message.content } });
        return true;
      }
      default:
        // The runner writes no HUMAN row (the turn's message is the server's
        // user.message) and no TOOL row (results ride their tool use's row).
        return true;
    }
  }

  /** Whether the boundary may still rewrite this row (never on a harness that declares no boundary). */
  private awaitsBoundary(row: ToolCall, final: boolean): boolean {
    return !final && this.deps.boundaryRewritesRow !== undefined && this.deps.boundaryRewritesRow(row);
  }

  /** The row's tool use (and its ask, and a sub-agent's thread start), or false when it is not yet known to run or ask. */
  private writeToolUse(thread: Thread, row: ToolCall, subAgents: ReadonlyMap<string, SubAgentRun>, final: boolean): boolean {
    if (isToolCallRowHidden(row)) return true;
    const asks = row.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL;
    if (!asks && this.awaitsBoundary(row, final)) return false;
    const id = toolUseEventId(this.deps.runId, row.id);
    const input = (row.args ?? {}) as JsonObject;
    const permission = row.requiresApproval ? "ask" : "";
    const sessionThreadId = thread.threadId;
    if (row.mcpServerSlug !== "") {
      this.push(thread.threadId, id, {
        case: "agentMcpToolUse",
        value: { id, input, mcpServerName: row.mcpServerSlug, name: row.name, evaluatedPermission: permission, sessionThreadId },
      });
    } else {
      this.push(thread.threadId, id, {
        case: "agentToolUse",
        value: { id, input, name: row.name, evaluatedPermission: permission, sessionThreadId },
      });
    }
    if (row.requiresApproval) {
      const askId = permissionAskedEventId(id);
      this.push(thread.threadId, askId, {
        case: "stigmerPermissionAsked",
        value: {
          id: askId,
          toolUseId: id,
          message: row.approvalMessage,
          argsPreview: row.argsPreview,
          policySource: POLICY_SOURCE_WORDS[row.approvalPolicySource],
          policyHook: row.approvalPolicyHook,
          contentDigest: row.approvalContentDigest,
        },
      });
    }
    const subAgent = subAgents.get(row.id);
    const subThread = this.threads.get(row.id);
    if (subAgent !== undefined && subThread !== undefined) {
      this.writeThreadStart(subAgent);
      this.walk(subThread, subAgents, final);
    }
    return true;
  }

  /** The row's result (after a sub-agent's thread end), or false when it has not settled beyond the boundary's reach. */
  private writeToolResult(thread: Thread, row: ToolCall, subAgents: ReadonlyMap<string, SubAgentRun>, final: boolean): boolean {
    if (isToolCallRowHidden(row)) return true;
    const useId = toolUseEventId(this.deps.runId, row.id);
    const resultId = toolResultEventId(useId);
    if (this.known(resultId)) return true;
    const subAgent = subAgents.get(row.id);
    const subThread = this.threads.get(row.id);
    if (subAgent !== undefined && subThread !== undefined) {
      if (this.frontiers.get(row.id)?.kind !== "end") this.walk(subThread, subAgents, final);
      // A sub-agent still at work holds its `task` result back; at the
      // terminal write (a pause) it holds nothing else back.
      if (!this.writeThreadEnd(subAgent)) return final;
    }
    const settled =
      row.status === ToolCallStatus.TOOL_CALL_COMPLETED ||
      row.status === ToolCallStatus.TOOL_CALL_FAILED ||
      row.status === ToolCallStatus.TOOL_CALL_SKIPPED ||
      (row.status === ToolCallStatus.TOOL_CALL_INTERRUPTED && final);
    // waiting or still running: at the terminal write it holds nothing back
    if (!settled) return final;
    // A row the boundary may still rewrite never reaches here: its tool use
    // held the walk back first (writeToolUse), whether or not it was sent.
    const isError = row.status !== ToolCallStatus.TOOL_CALL_COMPLETED;
    const text = isError ? row.error || row.result : row.result;
    const content = text === "" ? [] : [{ type: "text", text }];
    if (row.mcpServerSlug !== "") {
      this.push(thread.threadId, resultId, { case: "agentMcpToolResult", value: { id: resultId, mcpToolUseId: useId, content, isError } });
    } else {
      this.push(thread.threadId, resultId, { case: "agentToolResult", value: { id: resultId, toolUseId: useId, content, isError } });
    }
    // An offloaded output: the result carries its head, and where the whole
    // output is stored follows it (the persist chokepoint offloaded it
    // before this read).
    const ref = row.outputRef;
    if (ref !== undefined && ref.storageKey !== "") {
      const fullId = toolResultFullOutputEventId(useId);
      this.push(thread.threadId, fullId, {
        case: "stigmerToolResultFullOutput",
        value: {
          id: fullId,
          toolUseId: useId,
          storageKey: ref.storageKey,
          sizeBytes: ref.sizeBytes,
          contentHash: ref.contentHash,
          mimeType: ref.mimeType,
          isImage: ref.isImage,
        },
      });
    }
    return true;
  }

  /** A sub-agent's thread opens: created, the message it was sent, running. Written on the primary thread. */
  private writeThreadStart(row: SubAgentRun): void {
    const thread = threadId(this.deps.runId, row.id);
    const created = threadEventId(thread, "created");
    this.push("", created, { case: "sessionThreadCreated", value: { id: created, agentName: row.name, sessionThreadId: thread } });
    const sent = threadEventId(thread, "sent");
    this.push("", sent, {
      case: "agentThreadMessageSent",
      value: { id: sent, toSessionThreadId: thread, toAgentName: row.name, content: row.input === "" ? [] : [{ type: "text", text: row.input }] },
    });
    const running = threadEventId(thread, "running");
    this.push("", running, { case: "sessionThreadStatusRunning", value: { id: running, agentName: row.name, sessionThreadId: thread } });
  }

  /** A sub-agent's thread closes, once it finished and its own walk wrote everything; false until then. */
  private writeThreadEnd(row: SubAgentRun): boolean {
    const thread = threadId(this.deps.runId, row.id);
    const idle = threadEventId(thread, "idle");
    if (this.known(idle)) return true;
    const finished =
      row.status === SubAgentStatus.SUB_AGENT_COMPLETED ||
      row.status === SubAgentStatus.SUB_AGENT_FAILED ||
      row.status === SubAgentStatus.SUB_AGENT_CANCELLED;
    if (!finished || this.frontiers.get(row.id)?.kind !== "end") return false;
    const failed = row.status === SubAgentStatus.SUB_AGENT_FAILED;
    const received = threadEventId(thread, "received");
    const reply = failed ? row.error : row.output;
    this.push("", received, {
      case: "agentThreadMessageReceived",
      value: { id: received, fromSessionThreadId: thread, fromAgentName: row.name, content: reply === "" ? [] : [{ type: "text", text: reply }] },
    });
    this.push("", idle, {
      case: "sessionThreadStatusIdle",
      value: { id: idle, agentName: row.name, sessionThreadId: thread, stopReason: { type: failed ? "retries_exhausted" : "end_turn" } },
    });
    return true;
  }

  private known(id: string): boolean {
    return this.sent.has(id) || this.queued.has(id);
  }

  /** Queue one event, bounded to the log's cap, unless the log already holds it. */
  private push(thread: string, id: string, value: EventValue): void {
    if (this.known(id)) return;
    const event = elideToEncodedSize(
      SessionEventSchema,
      create(SessionEventSchema, { runId: this.deps.runId, threadId: thread, event: value }),
      SESSION_EVENT_MAX_BYTES,
    );
    this.queue.push(event);
    this.queued.add(id);
  }

  // ── Previews ──────────────────────────────────────────────────────────────

  /** The queued previews this write may send: a message only while its thread's prefix has reached it. */
  private decidePreviews(final: boolean): SessionEventPreview[] {
    const pending = this.pendingPreviews;
    this.pendingPreviews = [];
    if (final) return [];
    const out: SessionEventPreview[] = [];
    for (const preview of pending) {
      if (preview.kind === "tool-output") {
        const useId = toolUseEventId(this.deps.runId, preview.callId);
        if (this.known(toolResultEventId(useId))) continue;
        out.push(create(SessionEventPreviewSchema, {
          preview: { case: "stigmerToolOutputDelta", value: { toolUseId: useId, delta: preview.delta } },
        }));
        continue;
      }
      const prefix = scopeEventPrefix(this.deps.runId, preview.subAgentId);
      const id = preview.kind === "text" ? messageEventId(prefix, preview.index) : thinkingEventId(prefix, preview.index);
      if (this.known(id) || this.previewWithheld.has(id)) continue;
      const frontier = this.frontiers.get(preview.subAgentId ?? "");
      const reached =
        frontier !== undefined &&
        ((frontier.kind === "message" && frontier.index === preview.index) ||
          (frontier.kind === "end" && preview.index >= frontier.nextIndex));
      if (!reached) {
        this.previewWithheld.add(id);
        continue;
      }
      if (!this.previewStarted.has(id)) {
        this.previewStarted.add(id);
        out.push(create(SessionEventPreviewSchema, {
          preview: { case: "eventStart", value: { event: { id, type: preview.kind === "text" ? "agent.message" : "agent.thinking" } } },
        }));
      }
      if (preview.kind === "text") {
        out.push(create(SessionEventPreviewSchema, {
          preview: { case: "eventDelta", value: { eventId: id, delta: { type: "content_delta", index: 0, content: { type: "text", text: preview.text } } } },
        }));
      }
    }
    return out;
  }

  // ── Appending ─────────────────────────────────────────────────────────────

  private async append(previews: SessionEventPreview[], final: boolean): Promise<void> {
    const delay = this.deps.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.token ??= this.deps.credential().catch((err: unknown) => {
      console.warn(`[session-events] run=${this.deps.runId}: no scoped credential; appending with the ambient one: ${String(err)}`);
      return undefined;
    });
    const token = await this.token;
    const batches = this.batches();
    if (batches.length === 0) batches.push([]);
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b]!;
      const sendPreviews = b === batches.length - 1 ? previews : [];
      const attempts = final ? APPEND_RETRIES + 1 : APPEND_RETRIES;
      let outcome: "sent" | "refused" | "failed" = "failed";
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          await this.deps.client.appendSessionEvents(this.deps.runId, batch, sendPreviews, token);
          outcome = "sent";
          break;
        } catch (err) {
          if (err instanceof ConnectError && REFUSAL_CODES.has(err.code)) {
            console.error(
              `[session-events] run=${this.deps.runId}: the log refused ${batch.length} event(s), dropped: ` +
                `${err.message}; ids=${batch.map(idOf).join(",")}`,
            );
            outcome = "refused";
            break;
          }
          if (attempt + 1 < attempts) await delay(APPEND_RETRY_BASE_MS * 2 ** attempt);
          else console.warn(`[session-events] run=${this.deps.runId}: append failed; ${batch.length} event(s) wait for the next write: ${String(err)}`);
        }
      }
      if (outcome === "failed") {
        if (final) {
          this.lost += this.queue.length;
          console.error(`[session-events] run=${this.deps.runId}: session_events_lost=${this.lost}; the turn's terminal status is written without them`);
          this.forget(this.queue.length);
        }
        return;
      }
      this.settle(batch.length);
    }
  }

  /** The queue in appends that each fit the input's limits. */
  private batches(): SessionEvent[][] {
    const batches: SessionEvent[][] = [];
    let current: SessionEvent[] = [];
    let bytes = 0;
    for (const event of this.queue) {
      const size = eventSize(event);
      if (current.length > 0 && (current.length >= APPEND_MAX_EVENTS || bytes + size > APPEND_MAX_BYTES)) {
        batches.push(current);
        current = [];
        bytes = 0;
      }
      current.push(event);
      bytes += size;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  /** The first `count` queued events are in the log (or refused for good): never sent again. */
  private settle(count: number): void {
    for (const event of this.queue.slice(0, count)) {
      const id = idOf(event);
      this.queued.delete(id);
      this.sent.add(id);
    }
    this.queue = this.queue.slice(count);
  }

  /** Give up the first `count` queued events: logged as lost, never resent by this invocation. */
  private forget(count: number): void {
    this.settle(count);
  }
}

function idOf(event: SessionEvent): string {
  return event.event.case === undefined ? "" : event.event.value.id;
}

function eventSize(event: SessionEvent): number {
  return toBinary(SessionEventSchema, event).length;
}
