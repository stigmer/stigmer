"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { FileChangeProgress, FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { InterruptSessionInputSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { SessionResource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import type { ApiResourceReference as ProtoApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import {
  displayFileChangeSets,
  supersededRunIds,
  buildSessionProto,
  getErrorReason,
  type FileReviewSet,
  type QueuedMessage,
  type ResourceRef,
  type ToolUse,
  type Turn,
  type TurnLiveness,
  type TurnPhase,
  type SessionInput,
  type SessionResourceInput,
} from "@stigmer/client";
import type { MessageFileView } from "../run/MessageFiles.js";
import type { ServiceTierOption } from "../models/service-tier.js";
import type { ThinkingModeOption } from "../models/thinking-mode.js";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useFetch } from "../internal/useFetch.js";
import { useConversationStoreRef } from "../internal/store/index.js";
// Type-only import so the SharedRunFields doc links below resolve;
// the strict tsdoc gate (tsdoc:check) guards it against removal.
import { useCreateRun, type SharedRunFields } from "../run/useCreateRun.js";
import { useRunActions } from "../run/useRunActions.js";
import { useAnswerToolUse, type ToolUseAnswer } from "../run/useAnswerToolUse.js";
import { useStopBackgroundCommand } from "../run/useStopBackgroundCommand.js";
import {
  useReviewFileChanges,
  type FileReviewAction,
  type ReviewFileChangesOptions,
} from "../run/useReviewFileChanges.js";
import { useSession } from "./useSession.js";
import { useSessionEvents } from "./useSessionEvents.js";
import { useSessionRuns } from "./useSessionRuns.js";
import { useUpdateSession } from "./useUpdateSession.js";
import { ETAG_MISMATCH, maskedEdit } from "../internal/maskedEdit.js";
import { useLocalSessionWorker } from "./useLocalSessionWorker.js";

/**
 * How often the live turn's run is read again while it works, for what only
 * the run record carries live: its setup progress, its running usage and the
 * files it has changed so far. What the agent did comes from the session's
 * events, never from this read.
 */
const LIVE_RUN_REFRESH_MS = 3_000;

/** The phases a turn can be stopped from: every unfinished one (the session's interrupt stops them all). */
const STOPPABLE_PHASES: ReadonlySet<TurnPhase> = new Set<TurnPhase>([
  "pending",
  "running",
  "waiting",
  "paused",
]);

/**
 * How many times a follow-up's session update is made, the first included,
 * when each is refused because the session changed since it was read
 * (ETAG_MISMATCH): each attempt reads the session again and rebuilds the
 * update from that read. The last refusal fails the send.
 */
const SESSION_EDIT_ATTEMPTS = 3;

const EMPTY_ASKS: readonly ToolUse[] = [];
const EMPTY_SETS: readonly FileReviewSet[] = [];
const EMPTY_QUEUED: readonly QueuedMessage[] = [];

/** Whether the session's events hold message `id`: queued, or read by a turn as its message or a later one. */
function holdsMessage(
  turns: readonly Turn[] | undefined,
  queued: readonly QueuedMessage[] | undefined,
  id: string,
): boolean {
  return (
    (queued ?? []).some((message) => message.id === id) ||
    (turns ?? []).some(
      (turn) =>
        turn.userMessage?.id === id ||
        (turn.userMessage?.joinedIds ?? []).includes(id) ||
        turn.items.some((item) => item.kind === "user_message" && item.id === id),
    )
  );
}

/**
 * Options for {@link UseSessionConversationReturn.sendFollowUp}.
 *
 * Session-level fields (`resources`, `plugins`,
 * `skillRefs`, `vaults`, `includeMyVault`) trigger a `session.update()`
 * before the run is created. The update names only the provided fields;
 * omitted fields keep the session's stored values.
 */
export interface SendFollowUpOptions {
  /**
   * The model this message asks for. Omit it to run the model a less
   * specific layer chooses (the agent's run defaults, the operator
   * profile, the engine's default).
   *
   * @see {@link SharedRunFields.modelName}
   */
  readonly modelName?: string;
  /**
   * Move the conversation to another agent for this and all future
   * runs: a reference rebinds the session to that agent (the server
   * pins the version the reference names, the agent's current one when it
   * names none), `null` returns it to the built-in assistant, and
   * `undefined` leaves the session's agent alone. When provided, the
   * session is updated before the run is created.
   */
  readonly agentRef?: ResourceRef | null;
  /**
   * The conversation's repositories and folders, replacing the stored
   * ones. A repository kept by name and URL and sent without a token keeps
   * its stored token; a token sent replaces it. The conversation's Files
   * are kept: a File resource left out of the list stays, so a send that
   * rebuilds the workspace never drops a file given earlier, nor one
   * another participant's run adds while this send is made.
   */
  readonly resources?: SessionResourceInput[];
  /** Plugins the conversation uses, replacing the stored ones; each is used whole. */
  readonly plugins?: ResourceRef[];
  /** Skill references to enable for this run. */
  readonly skillRefs?: ResourceRef[];
  /**
   * Replace the vaults the conversation lists, in order. An empty list
   * leaves it listing none: it then uses only the sender's My vault, when
   * it includes that.
   */
  readonly vaults?: ResourceRef[];
  /**
   * Whether the conversation includes the sender's own My vault, read
   * ahead of the listed vaults. Only the conversation's creator may change
   * it (or its vaults): the server refuses anyone else's session update.
   */
  readonly includeMyVault?: boolean;
  /**
   * Files given with this message, by id.
   *
   * @see {@link SharedRunFields.fileIds}
   */
  readonly fileIds?: string[];
  /**
   * The message's files as its optimistic bubble shows them, until the
   * run's own record (`status.messageFiles`) replaces them.
   */
  readonly files?: readonly MessageFileView[];
  /**
   * Called once the run naming {@link fileIds} exists, and not when the
   * send fails, so a retry still names Files that exist. The composer's
   * `releaseFiles` goes here: it deletes the person's own Files the
   * conversation has copied.
   */
  readonly releaseFiles?: () => Promise<void>;
  /**
   * Interaction mode for this run.
   *
   * - `"agent"` (default): full tool access.
   * - `"plan"`: read-only analysis, no file mutations.
   */
  readonly interactionMode?: "agent" | "plan";
  /**
   * Service tier this message asks for (stigmer/stigmer#357): set only
   * when the person chose one, `"standard"` as explicitly as `"fast"`;
   * `undefined` keeps the tier of the layer that chose the model.
   *
   * @see {@link SharedRunFields.serviceTier}
   */
  readonly serviceTier?: ServiceTierOption;
  /**
   * Thinking mode this message asks for (stigmer/stigmer#772): set only
   * when the person chose one, `"disabled"` as explicitly as `"enabled"`;
   * `undefined` keeps the mode of the layer that chose the model.
   *
   * @see {@link SharedRunFields.thinkingMode}
   */
  readonly thinkingMode?: ThinkingModeOption;
  /**
   * Marks this run as a Build-from-plan turn.
   *
   * @see {@link SharedRunFields.buildFromPlan}
   */
  readonly buildFromPlan?: boolean;
  /**
   * Auto-approve every tool call for this run (bypass the HITL gate).
   *
   * @see {@link SharedRunFields.autoApproveAll}
   */
  readonly autoApproveAll?: boolean;
  /**
   * Workspace-relative file paths the user wants the agent to focus on.
   *
   * Lightweight "attention" signals — no upload, no injection. The agent
   * reads these files directly from the workspace filesystem.
   *
   * @see {@link SharedRunFields.workspaceFileRefs}
   */
  readonly workspaceFileRefs?: string[];
  /**
   * ID of the run this follow-up supersedes (edit-and-resubmit).
   *
   * The conversation read model hides the superseded run so the
   * edited message replaces the original in place.
   *
   * @see {@link SharedRunFields.supersedesRunId}
   */
  readonly supersedesRunId?: string;
}

/**
 * Return value of {@link useSessionConversation}.
 *
 * Provides the full conversation state for a session: its turns, folded
 * from the session's events; its runs, for each turn's lifecycle and files;
 * follow-up submission; the answers to tool uses that wait for a person;
 * file review; and session-level context (workspace entries, plugins,
 * skills).
 */
export interface UseSessionConversationReturn {
  /** The session object, or null while loading. */
  readonly session: Session | null;
  /**
   * The organization this conversation's turns are filed under: the
   * session's own (`session.metadata.org`) once it has loaded, the `org`
   * argument until then. A turn in a session belongs to that session's
   * organization, and the server refuses any other (stigmer/stigmer#1580),
   * so every org-scoped control of a session surface reads this value
   * rather than the caller's active organization.
   */
  readonly org: string;
  /**
   * The conversation's turns, in order: the session's events folded (each
   * turn's message, the agent's items, its asks, to-dos, file reviews and
   * phase). Objects no event touched keep their reference from render to
   * render, so memoized rows skip re-renders.
   *
   * Excludes turns replaced via edit-and-resubmit (a run whose id appears
   * as another run's `supersedesRunId`) — the edited message stands in the
   * original's place — and reconcile turns (`spec.reconcileFileReview`):
   * the message-less turn an Undo starts to put files back is not a turn of
   * the conversation.
   */
  readonly turns: readonly Turn[];
  /**
   * The conversation's runs, oldest first: each turn's lifecycle, stamps
   * and files (phase, error, usage, outputs, write-backs, captured file
   * changes). The live turn's run is read again while it works. Excludes
   * superseded and reconcile runs, as {@link turns} does.
   */
  readonly runs: readonly Run[];
  /** The newest turn that has not ended, or null when none works or waits. */
  readonly activeTurn: Turn | null;
  /** The live turn's run, or null (also while a just-sent turn is not yet listed). */
  readonly activeRun: Run | null;
  /**
   * The live turn's phase, or null when no turn is live. A turn just sent
   * reads `"pending"` until its first status arrives.
   */
  readonly activePhase: TurnPhase | null;
  /** True while the session's events are being delivered. */
  readonly isStreaming: boolean;
  /**
   * True after the session's follow starts and before its first events
   * arrive.
   */
  readonly isConnecting: boolean;

  /**
   * Submit a follow-up message. Internally creates a run (a new turn of the
   * session).
   *
   * When session-level fields (`agentRef`, `resources`,
   * `plugins`, `skillRefs`) are provided in options, the
   * session is updated via `session.update()` before creating the
   * run.
   */
  readonly sendFollowUp: (
    message: string,
    options?: SendFollowUpOptions,
  ) => Promise<void>;
  /** True when the input should be enabled (no live turn, not creating). */
  readonly canSendFollowUp: boolean;
  /** True during the create RPC call (between submit and run ID). */
  readonly isSending: boolean;
  /**
   * Error from the last `sendFollowUp` attempt, or `null`.
   *
   * Covers **both** failing paths — the optional `session.update()` and the
   * `create()` RPC — so a follow-up never fails silently. When set, the user's
   * message is preserved (see {@link pendingUserMessage}) and can be re-sent
   * via {@link retryLastSend}.
   */
  readonly sendError: Error | null;
  /** Reset `sendError` to `null` (keeps the preserved pending message). */
  readonly clearSendError: () => void;
  /**
   * Re-send the most recent `sendFollowUp` (same message and options). No-op
   * when nothing has been sent yet. Use as the "Retry" affordance on a failed
   * turn; clears {@link sendError} for the new attempt.
   */
  readonly retryLastSend: () => void;

  /**
   * Move the conversation to its agent's current version: the session's
   * agent reference is written back with `version: "latest"`, which the
   * server resolves to the version the agent's author last saved and pins
   * there, then the session is read again. The one way a conversation's
   * agent version changes; nothing else this hook does moves it. Rejects
   * with the update's error, and does nothing for a session that names
   * no agent.
   */
  readonly moveToCurrentAgentVersion: () => Promise<void>;

  /**
   * The user's message text, shown in the thread before the session's
   * events carry it. Retained when a send fails so the typed message is
   * never lost — pair with {@link sendError} to render the turn as failed
   * with a retry control.
   */
  readonly pendingUserMessage: string | null;
  /**
   * The files sent with {@link pendingUserMessage}, so the
   * optimistic bubble shows the turn's files, not just its text
   * (stigmer/stigmer#372). Set and cleared in lockstep with the message —
   * including retention on a failed send, where the chips are the evidence
   * of what Retry will re-send. Wire to `MessageThread.pendingFiles`.
   */
  readonly pendingFiles: readonly MessageFileView[] | null;
  /**
   * The messages sent while a turn worked that no turn has read yet, in
   * the order sent (`SessionFold.queued`): `waiting` until the working turn
   * reads it at its next step (or the turn after it starts with it),
   * `dropped` when a stop ended the turn first. Render each after the
   * thread; a read message moves into its turn.
   */
  readonly queued: readonly QueuedMessage[];

  /**
   * What the conversation holds, from the session spec: its repositories,
   * folders and Files. Empty while the session is not loaded.
   */
  readonly resources: readonly SessionResource[];
  /** Current plugin references from the session spec. Empty array when session is not loaded. */
  readonly plugins: readonly ProtoApiResourceReference[];
  /** Current skill references from the session spec. Empty array when session is not loaded. */
  readonly skillRefs: readonly ProtoApiResourceReference[];

  /** The live turn's tool uses that wait for a person's answer, in log order; empty when none. */
  readonly asks: readonly ToolUse[];
  /**
   * Answer a waiting tool use: allow it, deny it (with an optional message
   * the agent reads), or grant its class for the rest of the turn. The
   * session id is managed internally. Rejects with the server's error.
   */
  readonly answerToolUse: (
    toolUseId: string,
    answer: ToolUseAnswer,
    denyMessage?: string,
  ) => Promise<void>;
  /** The tool uses whose answer is in flight, by id. */
  readonly answeringToolUseIds: ReadonlySet<string>;
  /**
   * Each tool use's last failed answer, keyed by its id — surfaced in-card by
   * {@link MessageThread}/{@link ApprovalCard} beside the gate that failed.
   */
  readonly answerErrors: ReadonlyMap<string, Error>;
  /**
   * The most recent answer failure, or `null` — the scalar mirror of
   * {@link answerErrors} for a headless consumer wanting a single value
   * (e.g. the terminal surface).
   */
  readonly answerError: Error | null;
  /** Reset every answer error (both {@link answerErrors} and `answerError`). */
  readonly clearAnswerError: () => void;

  /**
   * Stop one command the agent runs in the background, by the tool use that
   * started it (`ToolUse.background`); the turn goes on, and the agent is
   * told a person stopped it. The session id is managed internally.
   * Rejects with the server's error.
   */
  readonly stopBackgroundCommand: (toolUseId: string) => Promise<void>;
  /** The tool uses whose background stop is in flight, by id. */
  readonly stoppingBackgroundToolUseIds: ReadonlySet<string>;
  /** Each tool use's last failed background stop, keyed by its id. */
  readonly stopBackgroundErrors: ReadonlyMap<string, Error>;

  /**
   * The newest turn's file reviews with files still undecided, whether or
   * not that turn has finished; empty when none. A turn never waits on
   * review, so its edits stay offered for Keep and Undo after it ends,
   * until a decision settles them or the next message is sent (the server
   * keeps what is still undecided then).
   */
  readonly fileReviewSets: readonly FileReviewSet[];
  /**
   * The captured change sets the conversation's runs hold (each file's
   * before/after bytes), keyed by change set id: what a review card renders
   * its diffs and capture provenance from. Never a decision's source.
   */
  readonly fileChangeCaptures: ReadonlyMap<string, FileChangeSet>;
  /**
   * Mid-turn live capture: the transient, non-authoritative snapshot of the
   * workspace delta accumulating during the live turn ("N files changed so
   * far"). Undefined when no turn is capturing. Never decidable — the
   * reviewed changes are {@link fileReviewSets}.
   */
  readonly fileChangeProgress: FileChangeProgress | undefined;
  /**
   * Keep or undo files of one of {@link fileReviewSets} (one file, or the
   * whole set). The session id is managed internally.
   */
  readonly reviewFileChanges: (
    changeSetId: string,
    action: FileReviewAction,
    options: ReviewFileChangesOptions,
  ) => Promise<void>;
  /** Decision keys ({@link fileDecisionKey}) currently being submitted. */
  readonly submittingFileDecisionKeys: ReadonlySet<string>;
  /**
   * Per-decision failures, keyed by {@link fileDecisionKey} — surfaced in-card
   * by {@link FileReviewCard} beside the failed control.
   */
  readonly fileDecisionErrors: ReadonlyMap<string, Error>;
  /** Clear the error for one decision key (e.g. before a retry of that target). */
  readonly clearFileDecisionError: (key: string) => void;
  /**
   * The most-recent file-review failure, or `null` when healthy — the scalar
   * mirror of {@link fileDecisionErrors}, for a headless consumer wanting a
   * single error value.
   */
  readonly fileReviewError: Error | null;
  /** Reset every file-review error (both {@link fileDecisionErrors} and `fileReviewError`). */
  readonly clearFileReviewError: () => void;

  /**
   * `true` when the live turn can be stopped: it is pending, running,
   * waiting for an answer, or paused. Drive the composer's Stop affordance
   * off this.
   */
  readonly isStoppable: boolean;
  /**
   * Stop the live turn, with progressive escalation: the first call
   * interrupts the session (every unfinished turn stops gracefully); a
   * repeat call, because the turn is still winding down, terminates its run
   * (with `reason` recorded). No-op when nothing is {@link isStoppable}.
   */
  readonly stop: (reason?: string) => Promise<void>;
  /** `true` while a stop (interrupt or terminate) request is in flight. */
  readonly isStopping: boolean;
  /** Error from the last stop attempt, or `null` when healthy. */
  readonly stopError: Error | null;

  /**
   * `true` while the session or its runs are loading, or, for a session with
   * runs, until the first of its events arrive.
   */
  readonly isLoading: boolean;
  /** Error from session or run list loading, or `null` when healthy. */
  readonly loadError: Error | null;

  /**
   * `true` while the session's follow is reconnecting after a dropped
   * stream. The conversation stays visible and `streamError` remains
   * `null` — surface a subtle "Reconnecting…" hint rather than an error.
   */
  readonly isReconnecting: boolean;
  /**
   * `true` when the follow opened but delivered nothing within the watchdog
   * window, even after a silent reconnect. Surface an actionable banner
   * wired to {@link reconnectStream}.
   */
  readonly connectTimedOut: boolean;
  /**
   * `true` when the live turn works but nothing arrived for the slow-stall
   * window. Purely informational ("still working — taking longer than
   * usual"); cleared by the next event. Never an error.
   */
  readonly isSlow: boolean;
  /**
   * What the live turn is doing now, from its newest `stigmer.run.liveness`
   * preview: each open operation with its age, and how long the turn has
   * waited on its model. `undefined` when no turn works or none arrived.
   * The ages are the runner's when it sent the preview; count on from the
   * moment this value changes.
   */
  readonly liveness: TurnLiveness | undefined;
  /**
   * Why the follow ended (refused), or `null`. A dropped stream never ends
   * it: the follow reconnects for as long as the outage lasts.
   */
  readonly streamError: Error | null;
  /** Re-open the session's follow (the conversation stays on screen). */
  readonly reconnectStream: () => void;
}

/**
 * Behavior hook that encapsulates the full conversation lifecycle for
 * a session: its turns, read from the session's event log; its runs, for
 * each turn's lifecycle and files; submitting follow-up messages; answering
 * the tool uses that wait for a person; reviewing a turn's file changes;
 * stopping the live turn; and updating session-level workspace entries.
 *
 * Composes {@link useSession}, {@link useSessionRuns},
 * {@link useSessionEvents}, {@link useCreateRun}, {@link useAnswerToolUse},
 * {@link useReviewFileChanges} and {@link useUpdateSession} into a single
 * return value that drives both {@link MessageThread} and
 * {@link SessionComposer}.
 *
 * Platform builders get the complete conversation loop without
 * reimplementing orchestration logic.
 *
 * For local run, this hook also owns the session's runner worker
 * lifecycle: while the session is open it keeps a worker polling the
 * session task queue, and it tears the worker down on close. This is a
 * no-op unless a `runnerAdapter` is configured and the session runs
 * locally, so it is safe in every environment.
 *
 * @param sessionId - Session to display and converse in. Pass `null` to skip.
 * @param org - Organization id (a slug is also accepted) to act in until the session has loaded; after that the session's own organization is used (the returned `org`).
 *
 * @example
 * ```tsx
 * function Chat({ sessionId, org }: { sessionId: string; org: string }) {
 *   const conv = useSessionConversation(sessionId, org);
 *
 *   if (conv.isLoading) return <Spinner />;
 *
 *   return (
 *     <>
 *       <MessageThread
 *         turns={conv.turns}
 *         runs={conv.runs}
 *         pendingUserMessage={conv.pendingUserMessage}
 *         onAnswerToolUse={conv.answerToolUse}
 *         answeringToolUseIds={conv.answeringToolUseIds}
 *       />
 *       <SessionComposer
 *         onSubmit={(msg, model) => conv.sendFollowUp(msg, { modelName: model })}
 *         disabled={!conv.canSendFollowUp}
 *         isSubmitting={conv.isSending}
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export function useSessionConversation(
  sessionId: string | null,
  org: string,
): UseSessionConversationReturn {
  const stigmer = useStigmer();
  const {
    session,
    isLoading: sessionLoading,
    error: sessionError,
    refetch: refetchSession,
  } = useSession(sessionId);
  const {
    runs: listedRuns,
    isLoading: runsLoading,
    error: runsError,
    refetch,
  } = useSessionRuns(sessionId, {
    // Re-list on app-relaunch / tab refocus so a run that appeared while
    // backgrounded is picked up without the user having to act.
    refetchOnWindowFocus: true,
  });
  const {
    send: sendMessage,
    isCreating,
    clearError: clearCreateError,
  } = useCreateRun();
  const { update: updateSession } = useUpdateSession();
  const turnOrg = session?.metadata?.org || org;
  const {
    answerToolUse: rawAnswerToolUse,
    submittingToolUseIds,
    errorsByToolUseId,
    error: answerError,
    clearError: clearAnswerError,
  } = useAnswerToolUse();
  const {
    stopBackgroundCommand: rawStopBackgroundCommand,
    stoppingToolUseIds: stoppingBackgroundToolUseIds,
    errorsByToolUseId: stopBackgroundErrors,
  } = useStopBackgroundCommand();
  const {
    reviewFileChanges: rawReviewFileChanges,
    submittingDecisionKeys,
    decisionErrors: fileDecisionErrors,
    clearDecisionError: clearFileDecisionError,
    error: fileReviewError,
    clearError: clearFileReviewError,
  } = useReviewFileChanges();

  // Local run: attach the session's runner worker while it is open and
  // detach it on close. No-op for cloud sessions or when no adapter is set.
  useLocalSessionWorker(sessionId, session);

  // The session's events, folded, in a store that outlives renders.
  const conversationStore = useConversationStoreRef();
  const events = useSessionEvents(sessionId, { store: conversationStore });
  const foldTurns = events.fold?.turns;
  const wakeFollow = events.wake;

  // The run a send just created, until its turn appears in the events: it
  // holds the optimistic bubble up across the gap.
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  // The message a send queued for the working turn, until the events show
  // it (queued, or read by a turn): the optimistic bubble stays up till then.
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null,
  );
  // The pending message's files, kept in lockstep with the text: one
  // pending turn, two facets. Held separately (not an object) so existing
  // pendingUserMessage consumers keep their string contract.
  const [pendingFiles, setPendingFiles] = useState<
    readonly MessageFileView[] | null
  >(null);
  // Dedicated send-failure state, distinct from the create hook's internal
  // error so it can also cover the session.update() path. The last send's
  // arguments are captured for an exact retry.
  const [sendError, setSendError] = useState<Error | null>(null);
  const lastSendRef = useRef<{
    message: string;
    options?: SendFollowUpOptions;
  } | null>(null);

  const listedById = useMemo(() => {
    const map = new Map<string, Run>();
    for (const run of listedRuns) {
      const id = run.metadata?.id;
      if (id) map.set(id, run);
    }
    return map;
  }, [listedRuns]);

  // The newest turn that has not ended: the live one. A reconcile turn is
  // never the conversation's live turn — it has no message to show, and the
  // composer stays open while it puts the undone files back.
  const liveTurn = useMemo(() => {
    for (let i = (foldTurns?.length ?? 0) - 1; i >= 0; i--) {
      const turn = foldTurns![i]!;
      if (!isConversationTurn(turn, listedById.get(turn.runId))) continue;
      return turn.ended ? null : turn;
    }
    return null;
  }, [foldTurns, listedById]);

  const activeRunId = pendingRunId ?? liveTurn?.runId ?? null;

  // The live turn's run, read again while it works (LIVE_RUN_REFRESH_MS).
  const { data: liveRun, refetch: refetchLiveRun } = useFetch(
    activeRunId ? () => stigmer.run.get(activeRunId) : null,
    [activeRunId, stigmer],
    null,
    {
      cacheKey: activeRunId ? `agent-execution:${activeRunId}` : undefined,
      refetchInterval: activeRunId ? LIVE_RUN_REFRESH_MS : false,
    },
  );
  const activeRun =
    liveRun !== null && liveRun.metadata?.id === activeRunId ? liveRun : null;

  // Once the sent turn appears in the events, the optimistic state hands
  // over to it: the pending run, message and files clear, and so
  // does a stale send error.
  const foldQueued = events.fold?.queued;
  const sentTurnArrived =
    (pendingRunId !== null && (foldTurns ?? []).some((turn) => turn.runId === pendingRunId)) ||
    (pendingMessageId !== null && holdsMessage(foldTurns, foldQueued, pendingMessageId));
  useEffect(() => {
    if (!sentTurnArrived) return;
    setPendingRunId(null);
    setPendingMessageId(null);
    setPendingUserMessage(null);
    setPendingFiles(null);
    setSendError(null);
  }, [sentTurnArrived]);

  // The run list is read again when, after it has loaded, the events show a
  // turn it does not hold (another client's message; a send reads the list
  // itself), once per such turn.
  const requestedRunIdsRef = useRef<Set<string>>(new Set());
  const newestTurn = foldTurns?.at(-1);
  const unlistedRunId =
    !runsLoading && newestTurn !== undefined && !listedById.has(newestTurn.runId)
      ? newestTurn.runId
      : null;
  useEffect(() => {
    if (unlistedRunId === null || requestedRunIdsRef.current.has(unlistedRunId)) return;
    requestedRunIdsRef.current.add(unlistedRunId);
    refetch();
  }, [unlistedRunId, refetch]);

  // ...and when a live turn ends (its final status, usage, outputs and
  // captured files) — a change seen while the session is open, never the
  // fold that opening it delivers.
  const liveRunId = liveTurn?.runId ?? null;
  const previousLiveRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousLiveRunIdRef.current;
    previousLiveRunIdRef.current = liveRunId;
    if (previous !== null && previous !== liveRunId) refetch();
  }, [liveRunId, refetch]);

  // Runs replaced via edit-and-resubmit (the shared conversation rule —
  // see supersededRunIds in @stigmer/client). The extra id is the live run's
  // link: right after a resubmit, its turn shows before the list delivers
  // the new run.
  const liveSupersededId = activeRun?.spec?.supersedesRunId || null;
  const supersededIds = useMemo(
    () => supersededRunIds(listedRuns, liveSupersededId),
    [listedRuns, liveSupersededId],
  );

  const runs = useMemo<readonly Run[]>(() => {
    const merged = listedRuns.map((run) =>
      activeRun !== null && run.metadata?.id === activeRun.metadata?.id ? activeRun : run,
    );
    if (activeRun !== null && !listedById.has(activeRun.metadata?.id ?? "")) {
      merged.push(activeRun);
    }
    return merged.filter(
      (run) =>
        run.spec?.reconcileFileReview !== true && !supersededIds.has(run.metadata?.id ?? ""),
    );
  }, [listedRuns, activeRun, listedById, supersededIds]);

  const turns = useMemo<readonly Turn[]>(
    () =>
      (foldTurns ?? []).filter(
        (turn) =>
          !supersededIds.has(turn.runId) &&
          isConversationTurn(turn, listedById.get(turn.runId)),
      ),
    [foldTurns, supersededIds, listedById],
  );

  const activePhase: TurnPhase | null =
    activeRunId === null ? null : (liveTurn?.status?.phase ?? "pending");
  const isStoppable =
    liveTurn !== null && activePhase !== null && STOPPABLE_PHASES.has(activePhase);

  // Stop: the session's interrupt first; a repeat press for the same run,
  // while it still winds down, terminates it.
  const runActions = useRunActions(activeRunId, { onSuccess: refetch });
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [interruptError, setInterruptError] = useState<Error | null>(null);
  const interruptedRunRef = useRef<string | null>(null);
  const terminate = runActions.terminate;
  const stop = useCallback(
    async (reason?: string): Promise<void> => {
      if (!isStoppable || !sessionId || !activeRunId) return;
      if (interruptedRunRef.current === activeRunId) {
        await terminate(reason);
        return;
      }
      interruptedRunRef.current = activeRunId;
      setIsInterrupting(true);
      setInterruptError(null);
      try {
        await stigmer.session.interrupt(create(InterruptSessionInputSchema, { sessionId }));
      } catch (err) {
        interruptedRunRef.current = null;
        setInterruptError(toError(err));
      } finally {
        setIsInterrupting(false);
      }
    },
    [isStoppable, sessionId, activeRunId, terminate, stigmer],
  );

  // A message is sent while a turn works too: it waits in the session's
  // queue, and the working turn reads it at its next step. Only a turn that
  // waits for an answer or is paused holds the composer closed (the server
  // takes only the answer, or the resume, then).
  const canSendFollowUp = !isCreating && activePhase !== "waiting" && activePhase !== "paused";
  const queued = foldQueued ?? EMPTY_QUEUED;

  const resources = useMemo<readonly SessionResource[]>(
    () => session?.spec?.resources ?? [],
    [session],
  );

  const plugins = useMemo<readonly ProtoApiResourceReference[]>(
    () => session?.spec?.plugins ?? [],
    [session],
  );

  const skillRefs = useMemo<readonly ProtoApiResourceReference[]>(
    () => session?.spec?.skillRefs ?? [],
    [session],
  );

  const sendFollowUp = useCallback(
    async (message: string, options?: SendFollowUpOptions): Promise<void> => {
      if (!sessionId || !session) return;

      // A follow waiting out a backoff re-opens now, so the new turn's
      // events arrive as they are written.
      wakeFollow();

      // Capture for retry and clear any prior failure before the new attempt.
      lastSendRef.current = { message, options };
      setSendError(null);
      // A Build-from-plan turn shows no optimistic bubble: its message is a
      // machine-written label, not user prose, and the thread hides the turn
      // entirely (the plan card's "Starting build…" state covers the send
      // window). It is still set on FAILURE below, so a failed build send
      // renders the failed-with-retry bubble instead of vanishing.
      if (!options?.buildFromPlan) {
        setPendingUserMessage(message);
        setPendingFiles(options?.files ?? null);
      }

      try {
        const needsSessionUpdate =
          options?.agentRef !== undefined ||
          options?.resources !== undefined ||
          options?.plugins !== undefined ||
          options?.skillRefs !== undefined ||
          options?.vaults !== undefined ||
          options?.includeMyVault !== undefined;

        if (needsSessionUpdate) {
          // The update names only the fields this send provides, so a
          // field written since (the generated subject) keeps its value.
          // The session is read fresh for the repository tokens and Files
          // the replacement resources keep (buildSessionEdit); an update
          // refused because the session changed since that read is built
          // again from a new read.
          for (let attempt = 1; ; attempt++) {
            const freshSession = await stigmer.session.get(sessionId);
            const { resource, paths } = buildSessionEdit(freshSession, {
              agentRef: options?.agentRef,
              resources: options?.resources,
              plugins: options?.plugins,
              skillRefs: options?.skillRefs,
              vaults: options?.vaults,
              includeMyVault: options?.includeMyVault,
            });
            try {
              await updateSession(resource, paths);
              break;
            } catch (err) {
              const stale = getErrorReason(err)?.reason === ETAG_MISMATCH;
              if (!stale || attempt >= SESSION_EDIT_ATTEMPTS) throw err;
            }
          }
          refetchSession();
        }

        const result = await sendMessage({
          org: turnOrg,
          sessionId,
          message,
          modelName: options?.modelName,
          fileIds: options?.fileIds,
          interactionMode: options?.interactionMode,
          serviceTier: options?.serviceTier,
          thinkingMode: options?.thinkingMode,
          buildFromPlan: options?.buildFromPlan,
          autoApproveAll: options?.autoApproveAll,
          workspaceFileRefs: options?.workspaceFileRefs,
          supersedesRunId: options?.supersedesRunId,
        });
        if (result.runId === null) {
          setPendingMessageId(result.messageId);
        } else {
          requestedRunIdsRef.current.add(result.runId);
          setPendingRunId(result.runId);
          refetch();
        }
        // The run exists and names the Files: the originals the
        // conversation copied can go.
        void options?.releaseFiles?.();
      } catch (err) {
        // Surface the failure and KEEP the user's message visible (do not clear
        // pendingUserMessage) so the turn renders as failed-with-retry instead
        // of vanishing. Covers both the update() and create() paths. For a
        // build turn this is the FIRST time the message is set — failure is
        // the one case where its label must become visible. The files
        // ride along: the failed bubble's chips are what Retry will re-send.
        setPendingUserMessage(message);
        setPendingFiles(options?.files ?? null);
        setSendError(toError(err));
        if (process.env.NODE_ENV !== "production") {
          console.error("[useSessionConversation] sendFollowUp failed:", err);
        }
      }
    },
    [sessionId, session, turnOrg, stigmer, sendMessage, updateSession, refetch, refetchSession, wakeFollow],
  );

  const moveToCurrentAgentVersion = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    // The agent reference as stored, re-pinned to `latest`; the update
    // names the reference alone.
    const freshSession = await stigmer.session.get(sessionId);
    const held = freshSession.spec?.agentRef;
    if (held === undefined || held.slug === "") return;
    const { resource, paths } = buildSessionEdit(freshSession, {
      agentRef: { org: held.org, slug: held.slug, kind: held.kind, version: LATEST_AGENT_VERSION },
    });
    await updateSession(resource, paths);
    refetchSession();
  }, [sessionId, stigmer, updateSession, refetchSession]);

  const retryLastSend = useCallback(() => {
    const last = lastSendRef.current;
    if (last) void sendFollowUp(last.message, last.options);
  }, [sendFollowUp]);

  const clearSendError = useCallback(() => {
    setSendError(null);
    clearCreateError();
  }, [clearCreateError]);

  const asks = liveTurn?.asks ?? EMPTY_ASKS;

  const answerToolUse = useCallback(
    async (toolUseId: string, answer: ToolUseAnswer, denyMessage?: string): Promise<void> => {
      if (!sessionId) return;
      await rawAnswerToolUse(sessionId, toolUseId, answer, denyMessage);
    },
    [sessionId, rawAnswerToolUse],
  );

  const stopBackgroundCommand = useCallback(
    async (toolUseId: string): Promise<void> => {
      if (!sessionId) return;
      await rawStopBackgroundCommand(sessionId, toolUseId);
    },
    [sessionId, rawStopBackgroundCommand],
  );

  // The conversation's newest turn, finished or not: the one whose edits
  // are offered for review.
  const reviewTurn = turns.at(-1);
  const fileReviewSets = useMemo<readonly FileReviewSet[]>(() => {
    const sets = reviewTurn?.fileReview ?? EMPTY_SETS;
    return sets.every((set) => set.undecided) ? sets : sets.filter((set) => set.undecided);
  }, [reviewTurn]);

  const fileChangeCaptures = useMemo<ReadonlyMap<string, FileChangeSet>>(() => {
    const map = new Map<string, FileChangeSet>();
    for (const run of runs) {
      for (const changeSet of displayFileChangeSets(run.status)) map.set(changeSet.id, changeSet);
    }
    return map;
  }, [runs]);

  // Mid-turn live capture: the transient "N files changed so far" snapshot
  // of the live turn. The server clears it once the turn's changes are
  // captured, so its mere presence means a turn is still accumulating them.
  const fileChangeProgress = activeRun?.status?.fileChangeProgress;

  const reviewFileChanges = useCallback(
    async (
      changeSetId: string,
      action: FileReviewAction,
      options: ReviewFileChangesOptions,
    ): Promise<void> => {
      if (!sessionId) return;
      await rawReviewFileChanges(sessionId, changeSetId, action, options);
    },
    [sessionId, rawReviewFileChanges],
  );

  // The live run is read again as soon as its turn changes phase, not only
  // on the next tick (its first read is the fetch itself). A failed read is
  // not a load error: the turn still renders from the events.
  const livePhase = liveTurn?.status?.phase;
  const previousLivePhaseRef = useRef<{ runId: string; phase: TurnPhase } | null>(null);
  useEffect(() => {
    const previous = previousLivePhaseRef.current;
    previousLivePhaseRef.current =
      liveRunId !== null && livePhase !== undefined ? { runId: liveRunId, phase: livePhase } : null;
    if (previous?.runId === liveRunId && livePhase !== undefined && previous.phase !== livePhase) {
      refetchLiveRun();
    }
  }, [liveRunId, livePhase, refetchLiveRun]);

  // A session whose runs are listed has events to show: it loads until the
  // first of them is folded (or the follow fails or times out). A session
  // with no runs has none to wait for.
  const isLoading =
    sessionLoading ||
    runsLoading ||
    (events.fold === null &&
      listedRuns.length > 0 &&
      events.error === null &&
      !events.connectTimedOut);
  const loadError = sessionError || runsError;

  return {
    session,
    org: turnOrg,
    turns,
    runs,
    activeTurn: liveTurn,
    activeRun,
    activePhase,
    isStreaming: events.isStreaming,
    isConnecting: events.isConnecting,

    sendFollowUp,
    canSendFollowUp,
    isSending: isCreating,
    sendError,
    clearSendError,
    retryLastSend,
    moveToCurrentAgentVersion,

    pendingUserMessage,
    pendingFiles,
    queued,

    resources,
    plugins,
    skillRefs,

    asks,
    answerToolUse,
    answeringToolUseIds: submittingToolUseIds,
    answerErrors: errorsByToolUseId,
    answerError,
    clearAnswerError,

    stopBackgroundCommand,
    stoppingBackgroundToolUseIds,
    stopBackgroundErrors,

    fileReviewSets,
    fileChangeCaptures,
    fileChangeProgress,
    reviewFileChanges,
    submittingFileDecisionKeys: submittingDecisionKeys,
    fileDecisionErrors,
    clearFileDecisionError,
    fileReviewError,
    clearFileReviewError,

    isStoppable,
    stop,
    isStopping: isInterrupting || runActions.isSubmitting,
    stopError: interruptError ?? runActions.error,

    isLoading,
    loadError,

    isReconnecting: events.isReconnecting,
    connectTimedOut: events.connectTimedOut,
    isSlow: events.isSlow,
    liveness: foldTurns?.at(-1)?.liveness,
    streamError: events.error,
    reconnectStream: events.reconnect,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Whether a folded turn is a turn of the conversation: not a reconcile turn
 * (the message-less run the server starts when an Undo lands on a finished
 * turn, to put files back) — known by its run when listed, and by having no
 * message and no items otherwise.
 */
function isConversationTurn(turn: Turn, run: Run | undefined): boolean {
  if (run?.spec?.reconcileFileReview === true) return false;
  return turn.userMessage !== undefined || turn.items.length > 0;
}

/**
 * The reference version that moves a conversation to its agent's current
 * version (the reference grammar's `latest`).
 */
const LATEST_AGENT_VERSION = "latest";

/**
 * The update a follow-up's session-level fields make: the session, named
 * by its id, with only the fields the caller provided, each named by its
 * path. An omitted field is not named, so it keeps its stored value (the
 * agent's pinned version among them: editing the workspace or the tools
 * never moves the agent version a conversation runs). An empty-array
 * override clears the collection; an agent override of `null` clears the
 * agent (the built-in assistant).
 *
 * An update that replaces the resources carries the etag `session` was read
 * at: it writes back the stored Files and repository tokens from that read,
 * so a File another participant's run added since must refuse it (the
 * caller reads again and rebuilds it), never be dropped. Any other update
 * carries no etag: it is a send, not an editor, and a subject written since
 * must not refuse it.
 */
function buildSessionEdit(
  session: Session,
  overrides: {
    agentRef?: ResourceRef | null;
    resources?: SessionResourceInput[];
    plugins?: ResourceRef[];
    skillRefs?: ResourceRef[];
    vaults?: ResourceRef[];
    includeMyVault?: boolean;
  },
) {
  const patch: Partial<SessionInput> = {
    ...(overrides.agentRef !== undefined && { agentRef: overrides.agentRef ?? undefined }),
    ...(overrides.resources !== undefined && {
      resources: keepStoredFiles(keepStoredRepositoryTokens(overrides.resources, session), session),
    }),
    ...(overrides.plugins !== undefined && { plugins: overrides.plugins }),
    ...(overrides.skillRefs !== undefined && { skillRefs: overrides.skillRefs }),
    ...(overrides.vaults !== undefined && { vaults: overrides.vaults }),
    ...(overrides.includeMyVault !== undefined && { includeMyVault: overrides.includeMyVault }),
  };
  const edit = maskedEdit(session, buildSessionProto, patch);
  if (overrides.resources === undefined && edit.resource.metadata !== undefined) {
    edit.resource.metadata.etag = "";
  }
  return edit;
}

/**
 * Replacement resources that keep each stored repository token. A
 * repository the replacement keeps by name and URL, sent without a token,
 * carries the stored one as read (the redaction marker, which the server
 * reads as "keep the stored value"); a token the caller sends wins.
 * Without this, a follow-up that rebuilds the workspace from URL and
 * branch alone would make the server destroy a token an integrator set.
 */
function keepStoredRepositoryTokens(
  resources: SessionResourceInput[],
  session: Session,
): SessionResourceInput[] {
  const storedTokens = new Map<string, string>();
  for (const stored of session.spec?.resources ?? []) {
    const resource = stored.resource;
    if (resource.case === "gitRepository" && resource.value.token) {
      storedTokens.set(repositorySlot(stored.name, resource.value.url), resource.value.token);
    }
  }
  return resources.map((entry) => {
    const repo = entry.gitRepository;
    if (!repo || repo.token) return entry;
    const token = storedTokens.get(repositorySlot(entry.name, repo.url));
    return token ? { ...entry, gitRepository: { ...repo, token } } : entry;
  });
}

/**
 * Replacement resources with the conversation's stored Files appended, each
 * one the replacement does not name itself. A send rewrites the
 * repositories and folders from the workspace picker, which never holds
 * Files; without this, every such send would drop the files given with
 * earlier messages.
 */
function keepStoredFiles(
  resources: SessionResourceInput[],
  session: Session,
): SessionResourceInput[] {
  const named = new Set(resources.flatMap((entry) => (entry.file?.fileId ? [entry.file.fileId] : [])));
  const kept = (session.spec?.resources ?? []).flatMap((stored): SessionResourceInput[] => {
    const resource = stored.resource;
    if (resource.case !== "file" || named.has(resource.value.fileId)) return [];
    return [{ file: { fileId: resource.value.fileId, mountPath: resource.value.mountPath || undefined } }];
  });
  return kept.length > 0 ? [...resources, ...kept] : resources;
}

/** A repository's token slot: its entry name and URL, as the server keys it. */
function repositorySlot(name: string | undefined, url: string): string {
  return `${name ?? ""}\u0000${url}`;
}
