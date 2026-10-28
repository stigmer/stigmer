/**
 * SessionEventEmitter: writes what the agent did into its session's event
 * log (`SessionCommandController.appendEvents`), in Claude Managed Agents'
 * events, from the rows the turn holds (`TurnRows`, the runner's own proto).
 *
 * Where it reads. The persist chokepoint calls {@link flush} on every write
 * of the status, after the secret backstop and the tool-output offload of
 * that write and before the status itself is sent (`persist-chokepoint.ts`),
 * so the log sees the rows redacted and bounded, in both process modes (the
 * agent host's rows reach the runtime's on every persist). The status
 * carries no rows: the log is where they go. One reader of the rows, never
 * a second writer of them.
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
 *   - a tool use, once it is known to run, to ask or to be skipped: at
 *     start on a harness whose boundary never rewrites a row, and on one
 *     that does (Claude, the `boundaryRewritesRow` capability) once the row
 *     is beyond the boundary's reach or the turn's terminal write proves
 *     the boundary ran. A call an unattended turn skipped carries
 *     `evaluated_permission: "deny"` ({@link permissionOf}): native's gate
 *     opens its row already saying so, and Claude's settle stamps it
 *     before the row's use is written;
 *   - a tool result, once its row settles, with the same boundary rule;
 *   - a hidden row (the collapsed shape) writes nothing.
 * A result whose output the chokepoint offloaded carries the output's
 * head, and `stigmer.tool_result.full_output` after it says where the
 * whole output is stored. An MCP tool's first use the log has not shown is
 * preceded, in its thread, by `stigmer.mcp.tool_definition`: the tool as
 * the model was offered it, from `rows.mcp_tool_definitions` (the builder's
 * projection of what the engine offered). Its id derives from the run, the
 * server and the tool, so a later call of the tool, in this invocation or
 * a resumed one, writes none; a tool use already in the log is never given
 * one after it.
 * So narration a boundary later blanks sits behind an unsealed row and
 * reaches neither the log nor a preview.
 *
 * Background commands. A command the agent started in the background has
 * an entry in `rows.background_commands` (the builder's projection of its
 * registry's facts). Its `stigmer.background_command.status` events,
 * `running` and then `ended`, are written only once the starting call's
 * result is in the log or queued before them, so the log never holds a
 * status for a tool use it has not shown; each in the starting call's
 * thread. While it runs, its output is previewed as
 * `stigmer.tool_output_delta` under the starting call's tool use, which
 * a client appends to the command, not to the call (the call's result is
 * in): only once the running status is in the log, held until then, and
 * dropped once the ended status is known, which carries the whole output.
 * Held output never rides the append that carries its running status: the
 * log publishes an append's previews before its events, so a client would
 * see output for a command it has not heard of. It leaves in an append of
 * previews alone, right after the write that sent the status.
 *
 * File review. A change set the turn captured (a CANDIDATE_CAPTURED on the
 * turn's own ledger, `rows.file_review_event_stream`) is written as one
 * `stigmer.file_review.changes`, read from that ledger at the same
 * chokepoint, once. The undo a turn's start does for an earlier turn
 * (`harness/owed-undos.ts`) is written as `stigmer.file_review.reconciled`
 * through {@link writeReconciled}, at once, before the engine's turn begins
 * and before the workspace lock is released. A decision is never the
 * runner's to write: `stigmer.file_review.decided` is the server's.
 *
 * Which rows are its to write. The rows a terminal arm appends are
 * reported ({@link skipRootRows}) and skipped, because the session's status
 * events and the run's stop cause say it; every other SYSTEM row is a note
 * of the harness (`stigmer.harness.note`). A reinvocation's seeded asks
 * (`harness/transcript/resume-seed.ts`) sit on messages with no text, which write
 * nothing, and their tool uses are already in the log.
 *
 * Its memory is the log. A resumed or retried turn first lists its run's
 * events ({@link begin}) and treats those ids as sent, so it resends
 * nothing whatever later edits did to the rows; a fresh turn skips the
 * read. Ids are derived (`ids.ts`), so a fact is named the same way by
 * every invocation. A message, thinking or note is named by its place in
 * its scope, and a resumed invocation's rows are its own: the asks it
 * seeded sit on messages before them that write nothing, so each scope's
 * own places are numbered on from the highest index the log already holds
 * there ({@link nextScopeIndexes}), and no id is reused.
 *
 * Previews. The transcript builder's observer hands every token delta to
 * {@link observe}; the previews ride the next append. A message is
 * previewed only while its thread's sealed prefix has reached it, and one
 * whose previews were ever held back is never previewed again (a partial
 * preview would show a client half a sentence). A running tool's output
 * does not wait for a write: the runtime's pump sends it on its own
 * cadence through {@link flushToolOutput}, an append of previews and no
 * events, because a harness may stream output while nothing else happens
 * (Claude's shell deltas arrive from the host's shell server, outside any
 * persist) and the
 * output would otherwise reach the session only after the result, when it
 * is dropped. What the turn has open goes the same way, alone, through
 * {@link sendLiveness}: the runtime's liveness pump (`liveness-pump.ts`).
 *
 * Its credential. The append presents the credential the values fetch
 * acquires, and renews a clocked one at 0.8 of its lifetime: a turn without
 * a run credential holds an exchange token minted for an hour, and before
 * #2455 a turn longer than that went on appending with it, every append
 * refused from the hour on, and lost its events at the end. A renewal that
 * fails keeps the credential in hand (still good until its expiry) and
 * tries again a minute later: falling back to the ambient credential would
 * be refused by the append, which admits only a credential bound to the
 * run. An append refused as unauthenticated (`Unauthenticated` under the
 * built-in runner verifier, `PermissionDenied` under the trusted-local
 * posture) re-acquires once and retries within the same write: a clock
 * skew, a server restarted with a new key. A run credential has no expiry
 * and is held for the turn.
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
import {
  FileChangeKind,
  FileReviewBlockReason,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { CapturedFileChange } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { SessionEventPreviewSchema, type SessionEventPreview } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";

import type { ScopedRunnerCredential, StigmerClient } from "../../client/stigmer-client.js";
import type { ReconciledUndo } from "../owed-undos.js";
import { elideToEncodedSize } from "../../shared/status-offload.js";
import { isToolCallRowHidden } from "../../shared/tool-row.js";
import type { OperationsSnapshot } from "../open-operations.js";
import type { TranscriptEvent } from "../transcript/events.js";
import {
  backgroundEndedEventId,
  backgroundRunningEventId,
  fileReviewChangesEventId,
  fileReviewReconciledEventId,
  harnessNoteEventId,
  compactedEventId,
  memoryRecalledEventId,
  messageEventId,
  permissionAskedEventId,
  scopeEventPrefix,
  structuredOutputEventId,
  thinkingEventId,
  thinkingTextEventId,
  threadEventId,
  threadId,
  toolDefinitionEventId,
  toolResultEventId,
  toolResultFullOutputEventId,
  toolUseEventId,
} from "./ids.js";
import type { AgentMessage, McpToolDefinition, ToolCall, SubAgentRun, TurnRows } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import {
  ApprovalPolicySource,
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
} from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

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

/** Fraction of a clocked credential's lifetime after which the emitter renews it (the runner token coordinator's). */
const CREDENTIAL_RENEW_FRACTION = 0.8;

/** Floor on the renewal delay, so a tiny lifetime cannot turn every append into an exchange. */
const CREDENTIAL_MIN_RENEW_MS = 5_000;

/** How long after a failed acquisition the emitter tries again (the runner token coordinator's retry delay). */
const CREDENTIAL_RETRY_MS = 60_000;

/** The refusals that may mean the credential, not the event: re-acquired once before the batch is judged. */
const CREDENTIAL_REFUSALS: ReadonlySet<Code> = new Set([Code.Unauthenticated, Code.PermissionDenied]);

/**
 * The most characters of one background command's output held while its
 * running status is not yet in the log: more is dropped, since the ended
 * status carries the whole output.
 */
export const BACKGROUND_PREVIEW_HOLD_MAX_CHARS = 256 * 1024;

/** The most operations one liveness names: `RunLiveness.operations`' bound in the contract. */
export const LIVENESS_MAX_OPERATIONS = 256;

/** The longest tool name a liveness carries, in characters: `RunOpenOperation.name`'s bound in the contract. */
export const LIVENESS_NAME_MAX_CHARS = 256;

export interface SessionEventEmitterDeps {
  readonly client: Pick<StigmerClient, "appendSessionEvents" | "listRunSessionEvents">;
  readonly runId: string;
  /**
   * The credential the append presents, as the values fetch acquires it
   * (`StigmerClient.acquireScopedRunnerCredential`); acquired at the first
   * append and again before a clocked one lapses. Undefined, or an
   * undefined token, appends with the ambient credential.
   */
  readonly credential: () => Promise<ScopedRunnerCredential | undefined>;
  /** `Date.now` in production; tests drive a clock across an expiry. */
  readonly now?: () => number;
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
  | { readonly kind: "tool-output"; readonly callId: string; readonly delta: string }
  | { readonly kind: "background-output"; readonly callId: string; readonly delta: string };

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

/**
 * The permission policy's word for a call, as Managed Agents writes it on
 * `evaluated_permission`: "deny" for a call an unattended turn skipped
 * (UNATTENDED_SKIP: it would have asked, and no one could answer), "ask"
 * for a call that asks a person, "" otherwise. A hook's refusal stays "":
 * its row is a failure the hook reported, and reads as one.
 */
function permissionOf(row: ToolCall): string {
  if (row.approvalPolicySource === ApprovalPolicySource.UNATTENDED_SKIP) return "deny";
  return row.requiresApproval ? "ask" : "";
}

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
  /** The characters of each background command's output that wait to be previewed, by call id. */
  private readonly pendingBackgroundChars = new Map<string, number>();
  /** Previewed message ids already opened with an event_start. */
  private readonly previewStarted = new Set<string>();
  /** Message ids never to preview again (their previews were held back once). */
  private readonly previewWithheld = new Set<string>();
  /** Per scope prefix (`ids.ts` `scopeEventPrefix`), the index this invocation's own first place takes. */
  private scopeBases: ReadonlyMap<string, number> = new Map();
  /** Per scope (root ""), where this invocation's own messages begin: after the seeded asks' messages. */
  private readonly ownFrom = new Map<string, number>();
  /** Root positions of the rows a terminal arm appended. */
  private readonly armRows = new Set<number>();
  /** Per scope (root ""), where its last walk stopped. */
  private readonly frontiers = new Map<string, Frontier>();
  /** The sub-agent threads of the write being read, by sub-agent id. */
  private threads = new Map<string, Thread>();
  /** The definitions of the MCP tools the turn called, of the write being read, by `<server>/<tool>`. */
  private definitions = new Map<string, McpToolDefinition>();
  /** The credential in hand, and when to renew it (`undefined`: never, it has no expiry). */
  private held: { readonly token: string | undefined; readonly renewAtMs: number | undefined } | undefined;
  private acquiring: Promise<string | undefined> | undefined;
  private lost = 0;

  constructor(private readonly deps: SessionEventEmitterDeps) {}

  /**
   * Start writing: note where each scope's own messages begin in `rows`
   * (after the asks a reinvocation seeded, which write nothing), and on a
   * resumed or retried turn read back what this run already wrote and where
   * each scope's numbering stands. Before this call every flush writes
   * nothing, and the rows wait for the first flush after it. A failed read
   * is logged and the turn writes on: what it resends with the same bytes
   * the log accepts again, and anything else is refused and dropped, never
   * fatal.
   */
  async begin(args: { readonly sessionId: string; readonly resumed: boolean; readonly rows: TurnRows }): Promise<void> {
    this.ownFrom.set("", args.rows.messages.length);
    for (const row of args.rows.subAgentRuns) this.ownFrom.set(row.id, row.messages.length);
    if (args.resumed) {
      try {
        const ids = (await this.deps.client.listRunSessionEvents(args.sessionId, this.deps.runId)).map(idOf);
        for (const id of ids) this.sent.add(id);
        this.scopeBases = nextScopeIndexes(this.deps.runId, ids);
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
      case "background_output_delta": {
        if (event.delta === "") return;
        const waiting = this.pendingBackgroundChars.get(event.callId) ?? 0;
        if (waiting + event.delta.length > BACKGROUND_PREVIEW_HOLD_MAX_CHARS) return;
        this.pendingBackgroundChars.set(event.callId, waiting + event.delta.length);
        this.pendingPreviews.push({ kind: "background-output", callId: event.callId, delta: event.delta });
        return;
      }
      default:
        return;
    }
  }

  /**
   * Whether a running tool's output, or a background command's that may be
   * sent now, waits: what the runtime's pump asks before it asks for a
   * flush. A background command's held output leaves right after the write
   * that sends its running status ({@link flush}).
   */
  get toolOutputPending(): boolean {
    return this.pendingPreviews.some(
      (preview) =>
        preview.kind === "tool-output" ||
        (preview.kind === "background-output" && this.backgroundOutput(preview.callId) === "send"),
    );
  }

  /**
   * The running tools' output that waits, sent now as previews alone: no
   * event, no row read, no status write. Text and thinking previews stay
   * for the next write, whose read of the rows decides them. Called by the
   * persist chokepoint in its single flight (`persist-chokepoint.ts`
   * `flushPreviews`), so it never races a write's append. A preview is
   * ephemeral: a failed append is logged and the output is not resent.
   * Never throws.
   */
  async flushToolOutput(): Promise<void> {
    if (!this.began) return;
    const previews: SessionEventPreview[] = [];
    const rest: PendingPreview[] = [];
    for (const preview of this.pendingPreviews) {
      if (preview.kind === "background-output") {
        const fate = this.backgroundOutput(preview.callId);
        if (fate === "hold") rest.push(preview);
        else this.backgroundPreviewDone(preview, fate === "send" ? previews : undefined);
        continue;
      }
      if (preview.kind !== "tool-output") {
        rest.push(preview);
        continue;
      }
      const sent = this.toolOutputPreview(preview.callId, preview.delta);
      if (sent !== undefined) previews.push(sent);
    }
    this.pendingPreviews = rest;
    if (previews.length === 0) return;
    try {
      await this.deps.client.appendSessionEvents(this.deps.runId, [], previews, await this.credential());
    } catch (err) {
      if (err instanceof ConnectError && CREDENTIAL_REFUSALS.has(err.code)) this.credentialRefused();
      console.warn(`[session-events] run=${this.deps.runId}: sending ${previews.length} tool-output preview(s) failed; not resent: ${String(err)}`);
    }
  }

  /**
   * What the turn has open now, sent as one `stigmer.run.liveness` preview
   * in an append of its own: no event, no other preview, no status write
   * (the liveness pump's module header says why alone). An operation whose
   * result the log already holds is left out. Called by the persist
   * chokepoint in its single flight, as {@link flushToolOutput} is.
   * Resolves `refused` when the log refused the preview as invalid (a
   * server older than it), so the pump stops; any other failure is logged
   * and not resent. Never throws.
   */
  async sendLiveness(snapshot: OperationsSnapshot): Promise<"sent" | "refused"> {
    if (!this.began) return "sent";
    const runId = this.deps.runId;
    // Clamped to the contract, so a preview the log would refuse as invalid
    // never stops the pump: the oldest operations, each name within its bound.
    const operations = snapshot.operations
      .flatMap((operation) => {
        const toolUseId = toolUseEventId(runId, operation.callId);
        if (this.known(toolResultEventId(toolUseId))) return [];
        return [
          {
            toolUseId,
            name: livenessName(operation.name),
            elapsed: durationOf(operation.ageMs),
            threadId: operation.subAgentId === undefined ? "" : threadId(runId, operation.subAgentId),
          },
        ];
      })
      .slice(0, LIVENESS_MAX_OPERATIONS);
    const preview = create(SessionEventPreviewSchema, {
      preview: {
        case: "stigmerRunLiveness",
        value: {
          runId,
          operations,
          ...(snapshot.awaitingModelMs === undefined ? {} : { awaitingModelFor: durationOf(snapshot.awaitingModelMs) }),
        },
      },
    });
    try {
      await this.deps.client.appendSessionEvents(runId, [], [preview], await this.credential());
      return "sent";
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.InvalidArgument) return "refused";
      if (err instanceof ConnectError && CREDENTIAL_REFUSALS.has(err.code)) this.credentialRefused();
      console.warn(`[session-events] run=${runId}: sending the turn's liveness failed; not resent: ${String(err)}`);
      return "sent";
    }
  }

  /**
   * One write's events: what sealed since the last, then the append, before
   * the status write that follows it. `final` is the turn's terminal write:
   * every row is past the boundary and nothing streams. Never throws.
   */
  async flush(rows: TurnRows, opts: { readonly final: boolean }): Promise<void> {
    if (!this.began) return;
    try {
      this.collect(rows, opts.final);
    } catch (err) {
      console.error(`[session-events] run=${this.deps.runId}: reading the rows failed: ${String(err)}`);
    }
    const previews = this.decidePreviews(opts.final);
    if (this.queue.length === 0 && previews.length === 0) return;
    await this.append(previews, opts.final);
    // Output held for a command whose running status this write sent: alone,
    // after it (the module header).
    if (!opts.final && this.toolOutputPending) await this.flushToolOutput();
  }

  // ── Reading the rows ──────────────────────────────────────────────────────

  private collect(rows: TurnRows, final: boolean): void {
    const runId = this.deps.runId;
    const report = rows.recalledMemoriesReport;
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

    const subAgents = new Map(rows.subAgentRuns.map((row) => [row.id, row]));
    this.definitions = new Map(rows.mcpToolDefinitions.map((d) => [`${d.mcpServerSlug}/${d.name}`, d]));
    this.threads = new Map(
      rows.subAgentRuns.map((row) => [
        row.id,
        { subAgentId: row.id, threadId: threadId(runId, row.id), prefix: scopeEventPrefix(runId, row.id), messages: row.messages },
      ]),
    );
    const threads: Thread[] = [
      { threadId: "", prefix: scopeEventPrefix(runId, undefined), messages: rows.messages },
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

    this.collectBackgroundCommands(rows);
    this.collectFileReviewChanges(rows);

    if (rows.structuredOutput !== undefined && this.frontiers.get("")?.kind === "end" && final) {
      this.push("", structuredOutputEventId(runId), {
        case: "stigmerAgentStructuredOutput",
        value: { id: structuredOutputEventId(runId), output: rows.structuredOutput },
      });
    }
  }

  /**
   * Each background command's status events, once its starting call's
   * result is in the log or queued (the module header).
   */
  private collectBackgroundCommands(rows: TurnRows): void {
    if (rows.backgroundCommands.length === 0) return;
    const runId = this.deps.runId;
    const threads = callThreads(runId, rows);
    for (const command of rows.backgroundCommands) {
      const toolUseId = toolUseEventId(runId, command.callId);
      if (!this.known(toolResultEventId(toolUseId))) continue;
      const sessionThreadId = threads.get(command.callId) ?? "";
      const runningId = backgroundRunningEventId(toolUseId);
      this.push(sessionThreadId, runningId, {
        case: "stigmerBackgroundCommandStatus",
        value: { id: runningId, toolUseId, sessionThreadId, phase: "running", timeoutSeconds: command.timeoutSeconds },
      });
      if (command.ending === "") continue;
      const endedId = backgroundEndedEventId(toolUseId);
      this.push(sessionThreadId, endedId, {
        case: "stigmerBackgroundCommandStatus",
        value: {
          id: endedId,
          toolUseId,
          sessionThreadId,
          phase: "ended",
          ending: command.ending,
          ...(command.exitCode === undefined ? {} : { exitCode: command.exitCode }),
          stoppedBy: command.stoppedBy,
          stoppedByToolUseId: command.stoppedByCallId === "" ? "" : toolUseEventId(runId, command.stoppedByCallId),
          output: command.output,
          endedAt: command.endedAt,
        },
      });
    }
  }

  /** One `stigmer.file_review.changes` per change set the turn's own ledger captured (the module header). */
  private collectFileReviewChanges(rows: TurnRows): void {
    for (const event of rows.fileReviewEventStream?.events ?? []) {
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
    for (let index = 0; index < thread.messages.length; index++) {
      const message = thread.messages[index]!;
      if (!this.writeMessage(thread, message, index, final)) {
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

  /**
   * The index a row's place in its scope is named by: the scope's own rows
   * numbered on from what the log already holds there. A seeded ask's
   * message sits before them and writes nothing.
   */
  private placeIndex(scope: string, prefix: string, index: number): number {
    return (this.scopeBases.get(prefix) ?? 0) + index - (this.ownFrom.get(scope) ?? 0);
  }

  /** The message's events, or false when it still streams. */
  private writeMessage(thread: Thread, message: AgentMessage, index: number, final: boolean): boolean {
    switch (message.type) {
      case MessageType.MESSAGE_AI: {
        if (message.isStreaming && !final) return false;
        if (message.content === "") return true;
        const id = messageEventId(thread.prefix, this.placeIndex(thread.subAgentId ?? "", thread.prefix, index));
        this.push(thread.threadId, id, { case: "agentMessage", value: { id, content: [{ type: "text", text: message.content }] } });
        return true;
      }
      case MessageType.MESSAGE_THINKING: {
        if (message.isStreaming && !final) return false;
        const id = thinkingEventId(thread.prefix, this.placeIndex(thread.subAgentId ?? "", thread.prefix, index));
        this.push(thread.threadId, id, { case: "agentThinking", value: { id } });
        const textId = thinkingTextEventId(id);
        this.push(thread.threadId, textId, { case: "stigmerAgentThinking", value: { id: textId, thinkingId: id, text: message.content } });
        return true;
      }
      case MessageType.MESSAGE_SYSTEM: {
        if (thread.subAgentId === undefined && this.armRows.has(index)) return true;
        const id = harnessNoteEventId(thread.prefix, this.placeIndex(thread.subAgentId ?? "", thread.prefix, index));
        this.push(thread.threadId, id, { case: "stigmerHarnessNote", value: { id, text: message.content } });
        return true;
      }
      case MessageType.MESSAGE_COMPACTED: {
        const id = compactedEventId(thread.prefix, this.placeIndex(thread.subAgentId ?? "", thread.prefix, index));
        this.push(thread.threadId, id, { case: "agentThreadContextCompacted", value: { id } });
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
    const permission = permissionOf(row);
    const sessionThreadId = thread.threadId;
    if (row.mcpServerSlug !== "") {
      if (!this.known(id)) this.writeToolDefinition(thread.threadId, row, id);
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

  /** The `stigmer.mcp.tool_definition` before an MCP row's tool use, once per server and tool in the run (the module header). */
  private writeToolDefinition(thread: string, row: ToolCall, toolUseId: string): void {
    const definition = this.definitions.get(`${row.mcpServerSlug}/${row.name}`);
    if (definition === undefined) return;
    const id = toolDefinitionEventId(this.deps.runId, row.mcpServerSlug, row.name);
    this.push(thread, id, {
      case: "stigmerMcpToolDefinition",
      value: {
        id,
        toolUseId,
        mcpServerName: row.mcpServerSlug,
        name: row.name,
        description: definition.description,
        ...(definition.inputSchema === undefined ? {} : { inputSchema: definition.inputSchema }),
        inputSchemaOmitted: definition.inputSchemaOmitted,
      },
    });
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
    if (final) {
      this.pendingBackgroundChars.clear();
      return [];
    }
    const out: SessionEventPreview[] = [];
    const held: PendingPreview[] = [];
    for (const preview of pending) {
      if (preview.kind === "background-output") {
        const fate = this.backgroundOutput(preview.callId);
        if (fate === "hold") held.push(preview);
        else this.backgroundPreviewDone(preview, fate === "send" ? out : undefined);
        continue;
      }
      if (preview.kind === "tool-output") {
        const sent = this.toolOutputPreview(preview.callId, preview.delta);
        if (sent !== undefined) out.push(sent);
        continue;
      }
      const prefix = scopeEventPrefix(this.deps.runId, preview.subAgentId);
      const place = this.placeIndex(preview.subAgentId ?? "", prefix, preview.index);
      const id = preview.kind === "text" ? messageEventId(prefix, place) : thinkingEventId(prefix, place);
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
    this.pendingPreviews = [...held, ...this.pendingPreviews];
    return out;
  }

  /**
   * What becomes of a background command's output fragment (the module
   * header): `drop` once its ended status is known; `send` once its running
   * status is in the log; `hold` until then.
   */
  private backgroundOutput(callId: string): "send" | "hold" | "drop" {
    const toolUseId = toolUseEventId(this.deps.runId, callId);
    if (this.known(backgroundEndedEventId(toolUseId))) return "drop";
    return this.sent.has(backgroundRunningEventId(toolUseId)) ? "send" : "hold";
  }

  /** A background fragment leaves the queue: into `out` as its preview, or dropped when `out` is undefined. */
  private backgroundPreviewDone(preview: { readonly callId: string; readonly delta: string }, out: SessionEventPreview[] | undefined): void {
    const waiting = (this.pendingBackgroundChars.get(preview.callId) ?? 0) - preview.delta.length;
    if (waiting > 0) this.pendingBackgroundChars.set(preview.callId, waiting);
    else this.pendingBackgroundChars.delete(preview.callId);
    out?.push(
      create(SessionEventPreviewSchema, {
        preview: {
          case: "stigmerToolOutputDelta",
          value: { toolUseId: toolUseEventId(this.deps.runId, preview.callId), delta: preview.delta },
        },
      }),
    );
  }

  /** A running call's output as its preview; none once the call's result is in the log, where the output is whole. */
  private toolOutputPreview(callId: string, delta: string): SessionEventPreview | undefined {
    const useId = toolUseEventId(this.deps.runId, callId);
    if (this.known(toolResultEventId(useId))) return undefined;
    return create(SessionEventPreviewSchema, {
      preview: { case: "stigmerToolOutputDelta", value: { toolUseId: useId, delta } },
    });
  }

  // ── Appending ─────────────────────────────────────────────────────────────

  /** The credential every append presents: the one in hand, or a fresh one once it is due for renewal (the module header). */
  private credential(): Promise<string | undefined> {
    const now = (this.deps.now ?? Date.now)();
    if (this.held !== undefined && (this.held.renewAtMs === undefined || now < this.held.renewAtMs)) {
      return Promise.resolve(this.held.token);
    }
    this.acquiring ??= this.deps
      .credential()
      .then((credential) => {
        const lifetime = credential?.expiresInSeconds;
        const renewAtMs =
          lifetime === undefined || lifetime <= 0
            ? undefined
            : now + Math.max(lifetime * 1000 * CREDENTIAL_RENEW_FRACTION, CREDENTIAL_MIN_RENEW_MS);
        this.held = { token: credential?.token, renewAtMs };
        return credential?.token;
      })
      .catch((err: unknown) => {
        // Keep what is in hand: it is good until it lapses, and the ambient
        // credential would be refused anyway. Try again a minute later.
        const kept = this.held?.token;
        console.warn(
          `[session-events] run=${this.deps.runId}: ` +
            (kept === undefined ? "no scoped credential; appending with the ambient one" : "renewing the scoped credential failed; keeping the one in hand") +
            `, trying again in ${CREDENTIAL_RETRY_MS / 1000}s: ${String(err)}`,
        );
        this.held = { token: kept, renewAtMs: now + CREDENTIAL_RETRY_MS };
        return kept;
      })
      .finally(() => {
        this.acquiring = undefined;
      });
    return this.acquiring;
  }

  /** The log refused the credential in hand: due for renewal now, kept as the fallback if renewing fails. */
  private credentialRefused(): void {
    if (this.held !== undefined) this.held = { token: this.held.token, renewAtMs: Number.NEGATIVE_INFINITY };
  }

  private async append(previews: SessionEventPreview[], final: boolean): Promise<void> {
    const delay = this.deps.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let token = await this.credential();
    let renewed = false;
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
          if (err instanceof ConnectError && CREDENTIAL_REFUSALS.has(err.code) && !renewed) {
            // The credential lapsed or the server no longer knows its key:
            // a fresh one, once, and the same attempt again.
            renewed = true;
            this.credentialRefused();
            token = await this.credential();
            attempt -= 1;
            continue;
          }
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

/** A place-named id (`ids.ts`): a message, a thinking (and its text), a note or a compaction, `<scope prefix>.<m|t|n|c><index>`. */
const PLACE_ID = /^(.+)\.[mtnc](\d+)(?:\.text)?$/;

/**
 * For each scope prefix the run's logged ids name, the index after the
 * highest place the log holds there: where a resumed invocation numbers its
 * own rows from, so it never reuses an id an earlier invocation wrote under
 * other bytes. Ids that are not place-named are ignored.
 */
export function nextScopeIndexes(runId: string, ids: readonly string[]): Map<string, number> {
  const next = new Map<string, number>();
  for (const id of ids) {
    if (!id.startsWith(`${runId}.`)) continue;
    const match = PLACE_ID.exec(id);
    if (match === null) continue;
    const prefix = match[1]!;
    next.set(prefix, Math.max(next.get(prefix) ?? 0, Number(match[2]) + 1));
  }
  return next;
}

/** The thread each tool call of `rows` ran in, by call id: "" for the root's, the sub-agent's thread for one of its own. */
function callThreads(runId: string, rows: TurnRows): Map<string, string> {
  const threads = new Map<string, string>();
  for (const message of rows.messages) {
    for (const row of message.toolCalls) threads.set(row.id, "");
  }
  for (const subAgent of rows.subAgentRuns) {
    const thread = threadId(runId, subAgent.id);
    for (const message of subAgent.messages) {
      for (const row of message.toolCalls) threads.set(row.id, thread);
    }
  }
  return threads;
}

/** A tool's name as a liveness carries it: within the contract's bound, and never empty. */
function livenessName(name: string): string {
  const chars = [...name];
  if (chars.length === 0) return "tool";
  return chars.length > LIVENESS_NAME_MAX_CHARS ? chars.slice(0, LIVENESS_NAME_MAX_CHARS).join("") : name;
}

/** A non-negative span in milliseconds as a protobuf Duration. */
function durationOf(ms: number): { seconds: bigint; nanos: number } {
  const whole = Math.max(0, Math.floor(ms));
  return { seconds: BigInt(Math.floor(whole / 1000)), nanos: (whole % 1000) * 1_000_000 };
}

function idOf(event: SessionEvent): string {
  return event.event.case === undefined ? "" : event.event.value.id;
}

function eventSize(event: SessionEvent): number {
  return toBinary(SessionEventSchema, event).length;
}
