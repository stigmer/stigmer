/**
 * What a client holds once it folds a session's events (fold.ts): the
 * conversation as turns, each turn's items in the order the agent produced
 * them, its threads (sub-agents), its asks and their answers, its to-do
 * list, the files it changed and how each was decided, and the turn's own
 * phase. Plain, immutable data, built only from the session's events; a
 * client needs nothing else to show a conversation.
 *
 * Words, not enums: every state is the word the event contract uses (a
 * phase is `running`, a permission `ask`, a decision `keep`), so a client
 * in any language reads the same values the Managed Agents JSON carries.
 */
import type { JsonObject } from "@bufbuild/protobuf";

/** A turn's phase, as `stigmer.run.status` states it. */
export type TurnPhase =
  | "pending"
  | "running"
  | "waiting"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "terminated";

/** The phases that end a turn: it will not work again. */
export const TURN_ENDED_PHASES: ReadonlySet<TurnPhase> = new Set<TurnPhase>([
  "completed",
  "failed",
  "cancelled",
  "terminated",
]);

/**
 * Where a tool use stands:
 *   running ..... called, no result yet, its turn still works
 *   waiting ..... asks a person, no answer yet
 *   completed ... returned
 *   failed ...... returned an error
 *   denied ...... a person (or a rule) refused it
 *   stopped ..... its turn ended before it returned (nothing more will come)
 */
export type ToolUseState = "running" | "waiting" | "completed" | "failed" | "denied" | "stopped";

/** Why a tool use waits for a person: `stigmer.permission.asked`. */
export interface ToolAsk {
  readonly id: string;
  /** What to show the person who answers. */
  readonly message: string;
  /** A short preview of the input, secrets redacted. */
  readonly argsPreview: string;
  /** The rule that asked, as one word (`builtin_category`, `hook`, ...); "" for none. */
  readonly policySource: string;
  /** The plugin whose hook asked; "" for the agent's own hooks or none. */
  readonly policyHook: string;
  readonly processedAt: string;
}

/** A person's answer to a waiting tool use: `user.tool_confirmation`. */
export interface ToolConfirmation {
  readonly id: string;
  readonly result: "allow" | "deny";
  /** Why it was denied, for the agent; "" with allow. */
  readonly denyMessage: string;
  readonly processedAt: string;
}

/** A grant given on a tool use: every call of its class runs for the rest of the turn. */
export interface PermissionGrant {
  readonly id: string;
  readonly scope: string;
  readonly category: string;
  readonly server: string;
  /** The plugin whose hook asked, "" for the agent's own; undefined when no hook asked. */
  readonly hook: string | undefined;
  readonly tool: string;
  readonly processedAt: string;
}

/** A tool's result: `agent.tool_result` or `agent.mcp_tool_result`. */
export interface ToolResult {
  readonly id: string;
  /** The result's text blocks, joined. An offloaded output's head. */
  readonly text: string;
  readonly isError: boolean;
  readonly processedAt: string;
}

/** Where an offloaded output is stored: `stigmer.tool_result.full_output`. */
export interface ToolFullOutput {
  readonly storageKey: string;
  readonly sizeBytes: bigint;
  readonly contentHash: string;
  readonly mimeType: string;
  readonly isImage: boolean;
}

/** One tool call and everything the log says about it. */
export interface ToolUse {
  readonly kind: "tool_use";
  /** The tool use's event id: what an answer names (`tool_use_id`). */
  readonly id: string;
  readonly runId: string;
  /** The thread that made the call; "" for the primary thread. */
  readonly threadId: string;
  readonly name: string;
  /** The MCP server the tool belongs to; "" for a built-in tool. */
  readonly mcpServerName: string;
  readonly input: JsonObject;
  /** allow, ask or deny; "" when none was recorded. */
  readonly evaluatedPermission: string;
  readonly state: ToolUseState;
  readonly ask: ToolAsk | undefined;
  readonly confirmation: ToolConfirmation | undefined;
  readonly grant: PermissionGrant | undefined;
  readonly result: ToolResult | undefined;
  readonly fullOutput: ToolFullOutput | undefined;
  /** The output streamed so far while it runs (a preview, never stored); "" once it returned. */
  readonly liveOutput: string;
  /** The sub-agent this call started (a `task` call); undefined for any other call. */
  readonly thread: Thread | undefined;
  readonly processedAt: string;
}

/** A message the agent wrote. `live` while it is still being written (a preview). */
export interface MessageItem {
  readonly kind: "message";
  readonly id: string;
  readonly text: string;
  readonly live: boolean;
  readonly processedAt: string;
}

/** The agent's thinking. `live` while it is still being produced (a preview, no text yet). */
export interface ThinkingItem {
  readonly kind: "thinking";
  readonly id: string;
  readonly text: string;
  readonly live: boolean;
  readonly processedAt: string;
}

/** A line the platform added in its own voice: `stigmer.harness.note`. */
export interface NoteItem {
  readonly kind: "note";
  readonly id: string;
  readonly text: string;
  readonly processedAt: string;
}

/** The thread's context was compacted: `agent.thread_context_compacted`. */
export interface CompactedItem {
  readonly kind: "compacted";
  readonly id: string;
  readonly processedAt: string;
}

/** One entry of a thread, in the order the agent produced it. */
export type TurnItem = MessageItem | ThinkingItem | ToolUse | NoteItem | CompactedItem;

/** A sub-agent's thread, opened by its `task` tool use. */
export interface Thread {
  /** The thread's id: its `task` tool use's id. */
  readonly id: string;
  readonly agentName: string;
  /** What the agent asked the sub-agent to do. */
  readonly input: string;
  /** What the sub-agent answered (or its error, when it failed); "" until it finished. */
  readonly reply: string;
  /** stopped: its turn ended before it finished. */
  readonly state: "running" | "completed" | "failed" | "stopped";
  readonly items: ReadonlyArray<TurnItem>;
}

/** One item of a turn's to-do list (`TodoWrite` and each engine's name for it). */
export interface Todo {
  readonly id: string;
  readonly content: string;
  readonly status: "pending" | "in_progress" | "completed" | "cancelled";
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Which memories a turn recalled: `stigmer.memory.recalled`. */
export interface MemoryRecall {
  readonly selectionActive: boolean;
  readonly injectedMemoryIds: ReadonlyArray<string>;
  readonly embeddingModel: string;
}

/** An error the log reported for a turn: `session.error`. */
export interface TurnError {
  readonly id: string;
  /** The Managed Agents error type, for example unknown_error. */
  readonly type: string;
  readonly message: string;
  readonly processedAt: string;
}

/** The turn's own phase: the newest `stigmer.run.status`. */
export interface TurnStatus {
  readonly phase: TurnPhase;
  /** Why it ended (RunStatus.stop_cause), once it has; "" otherwise. */
  readonly stopCause: string;
  readonly error: string;
  readonly processedAt: string;
}

/** One file a turn changed, and what was decided about it. */
export interface FileReviewFile {
  readonly fileChangeId: string;
  readonly path: string;
  readonly previousPath: string;
  /** added, modified, deleted or renamed. */
  readonly change: string;
  readonly digest: string;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  /** complete, partial, binary or secret. */
  readonly reviewable: string;
  /**
   * undecided; kept; undoing (undo decided, not yet put back); undone (put
   * back); undo_failed (the put-back failed).
   */
  readonly state: "undecided" | "kept" | "undoing" | "undone" | "undo_failed";
  /** Who made the deciding decision (person, approved_command, eval_try, next_turn); "" while undecided. */
  readonly decidedBy: string;
}

/** A decision on a turn's changes: `stigmer.file_review.decided`. */
export interface FileReviewDecision {
  readonly id: string;
  readonly scope: "change_set" | "file";
  readonly fileChangeId: string;
  readonly action: "keep" | "undo";
  readonly expectedDigest: string;
  readonly origin: string;
  readonly reason: string;
  readonly processedAt: string;
}

/** An undo's outcome: `stigmer.file_review.reconciled`. */
export interface FileReviewReconcile {
  readonly id: string;
  readonly undonePaths: ReadonlyArray<string>;
  /** hash_mismatch or reconcile_failed; "" when the files were put back. */
  readonly failure: string;
  readonly failureDetail: string;
  readonly processedAt: string;
}

/** The files one turn changed, offered for review, and every decision on them. */
export interface FileReviewSet {
  readonly changeSetId: string;
  /** The turn that changed the files. */
  readonly runId: string;
  readonly aggregateDigest: string;
  readonly files: ReadonlyArray<FileReviewFile>;
  readonly decisions: ReadonlyArray<FileReviewDecision>;
  readonly reconciles: ReadonlyArray<FileReviewReconcile>;
  /** Whether any file is still undecided. */
  readonly undecided: boolean;
  readonly processedAt: string;
}

/** The message that started a turn: `user.message`. */
export interface UserMessage {
  readonly id: string;
  readonly text: string;
  readonly processedAt: string;
}

/** One turn: a run, from the message that started it to how it ended. */
export interface Turn {
  readonly runId: string;
  /** The message that started it; undefined for a turn that has none (a reconcile turn). */
  readonly userMessage: UserMessage | undefined;
  /** The primary thread's items, in order. */
  readonly items: ReadonlyArray<TurnItem>;
  /** The newest `stigmer.run.status`; undefined when the log holds none for the turn. */
  readonly status: TurnStatus | undefined;
  /** Whether the turn has ended: its status says so, or (with no status) a later turn began or the session went idle. */
  readonly ended: boolean;
  /** Every tool use of the turn (every thread) that waits for a person, in log order. */
  readonly asks: ReadonlyArray<ToolUse>;
  readonly todos: ReadonlyArray<Todo>;
  readonly structuredOutput: JsonObject | undefined;
  readonly memory: MemoryRecall | undefined;
  readonly fileReview: ReadonlyArray<FileReviewSet>;
  readonly errors: ReadonlyArray<TurnError>;
  /** The text of the primary thread's last agent.message; "" when it wrote none. */
  readonly answer: string;
}

/** The session's own status: the newest `session.status_running` or `session.status_idle`. */
export interface SessionStatusView {
  readonly state: "running" | "idle";
  /** Why it went idle (end_turn, requires_action, retries_exhausted, ...); "" while running or before any status. */
  readonly stopReason: string;
  /** With requires_action: the tool uses that wait, in log order. */
  readonly waitingOn: ReadonlyArray<string>;
}

/** A session's events, folded. */
export interface SessionFold {
  readonly turns: ReadonlyArray<Turn>;
  readonly status: SessionStatusView;
  /** The newest event's place in the log; 0n before any. A follow resumes after it. */
  readonly lastSeq: bigint;
}
