// The terminal session view: a session's conversation (its turns, read from
// the session's events, its subject written once at the top) with the live
// turn's to-dos and usage, the mid-turn file progress, the docked file-review
// decision, the working line, and the follow-up input with its agent/plan
// mode.
//
// Keys, on a terminal (key-owner.ts gives a surface that needs them, an open
// menu or the deny reason, the keyboard first):
//   - Esc stops a working turn, a waiting one included; a second Esc while it
//     winds down terminates it. The composer stays, and so does its draft.
//   - Ctrl+C clears a draft (the composer's). On an empty composer it says
//     the agent keeps working and how to come back (`leaveHint`, the host's
//     words), and a second press within two seconds leaves: the view exits
//     and the run goes on on the server.
//   - Shift+Tab or Ctrl+T switch plan and agent mode; Ctrl+O expands.
//
// On a terminal and off one: `canAnswer` (from terminal-mode.ts, or Ink's
// raw-mode support when a host omits it) decides whether anything reads keys.
// Off a terminal the view is read-only: no key handler is mounted, every
// prompt renders inert, and each ask is settled by `approveDefault` (denied
// when unset, the `stigmer` CLI's rule), with a line saying so; a file review
// stays pending and says it waits for a terminal. A load or stream failure is
// worded by errors.ts (what failed, the address, the next step), its raw
// message kept as a details line. `onTurnEnd` hears each turn end once.
//
// Proven by __tests__/session-view.test.tsx and session-frames.test.tsx.
import React, { useState, useEffect, useRef, useContext, useCallback, useMemo } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { resolvedSubject, type Turn, type ToolUse } from "@stigmer/client";
import { useSessionConversation, useStigmer } from "@stigmer/react-core";
import { MessageThread } from "../components/MessageThread.js";
import { TodoList } from "../components/TodoList.js";
import { FollowUpInput } from "../components/FollowUpInput.js";
import { UsageWidget } from "../components/UsageWidget.js";
import { Spinner } from "../components/Spinner.js";
import { WorkingLine } from "../components/WorkingLine.js";
import { FileChangeProgressBar } from "../components/FileChangeProgressBar.js";
import { FileReviewPrompt } from "../components/FileReviewPrompt.js";
import { useRoles } from "../theme.js";
import { describeConnectionFailure, type FailedStep } from "../errors.js";
import { TurnWatchContext } from "./turn-watch.js";
import { KeyOwnerProvider, useKeysFree } from "./key-owner.js";
import type { ComposerContext, ComposerExtensions } from "../input/extensions.js";
import type { ThreadNote } from "../thread-items.js";

/** Interaction mode type used for follow-up runs. */
export type InteractionMode = "agent" | "plan";

/** Props for {@link SessionView}. */
export interface SessionViewProps {
  /** Session ID to display and converse in. */
  readonly sessionId: string;
  /** Organization slug for creating follow-up runs. */
  readonly org: string;
  /**
   * Initial interaction mode for follow-up runs.
   *
   * - `"agent"` (default): full tool access.
   * - `"plan"`: read-only analysis, no file mutations.
   *
   * The user can toggle between modes with Ctrl+T during the session.
   * This prop sets the initial value; subsequent toggles are managed
   * as local state.
   */
  readonly mode?: InteractionMode;
  /**
   * Whether a person can answer prompts with the keyboard. Off a terminal it
   * is `false` and the view is read-only. When omitted, Ink's own reading is
   * used (stdin supports raw mode); `runInTerminal` passes the fuller rule,
   * which also asks whether the screen is live (`terminalMode`).
   */
  readonly canAnswer?: boolean;
  /**
   * How an ask is settled when no one can answer it (`canAnswer` false):
   * `"approve"` allows it, `"deny"` (the default) denies it, and the view
   * says which. `"leave"` settles nothing, for a view that only watches a
   * session someone else answers. Ignored on a terminal, where a person answers.
   */
  readonly approveDefault?: "approve" | "deny" | "leave";
  /**
   * The setting that approves asks off a terminal, in the host's own words,
   * which the view names when it settles one: `approveDefault: "approve"` by
   * default; a host CLI passes its flag (the bin passes `--approve-default approve`).
   */
  readonly approveSetting?: string;
  /**
   * Called once for each turn the view sees end (its status says it ended),
   * including turns already ended when it loads the session; a host that
   * waits for one run filters by `turn.runId`.
   */
  readonly onTurnEnd?: (turn: Turn) => void;
  /**
   * Whether the screen redraws in place (`terminalMode`'s `live`). Off, Ink
   * writes one final frame, and the thread renders whole inside it, once and
   * in order. Defaults to `true`; `runInTerminal` and the bin pass it.
   */
  readonly live?: boolean;
  /**
   * How to come back to the session, in the host's words, said when the
   * person presses Ctrl+C to leave: the CLI's "Come back with `stigmer resume
   * ses_…`". Omitted, the leave line says only that the agent keeps working.
   */
  readonly leaveHint?: string;
  /** The host's slash commands, completions and prompt history for the composer. */
  readonly composer?: ComposerExtensions;
}

/** How long the first Ctrl+C on an empty composer waits for the second. */
export const LEAVE_WINDOW_MS = 2000;

/** What the first Ctrl+C on an empty composer says, before the host's hint. */
export function leaveLine(working: boolean, leaveHint?: string): string {
  return ["Press Ctrl+C again to leave.", working ? "The agent keeps working." : "", leaveHint ?? ""].filter((part) => part !== "").join(" ");
}

/** An ask settled by `approveDefault` because no one could answer it. */
interface SettledAsk {
  readonly id: string;
  readonly name: string;
  readonly approved: boolean;
}

/** A failure, worded for a person: headline, cause, next step, details. */
function FailureBlock({ error, baseUrl, step }: { error: unknown; baseUrl: string; step: FailedStep }) {
  const role = useRoles();
  const failure = describeConnectionFailure(error, baseUrl, step);
  return (
    <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
      <Text {...(step === "stream" ? role.warning : role.danger)} bold>
        {failure.headline}
      </Text>
      <Text>{failure.cause}</Text>
      <Text>{failure.next}</Text>
      <Text {...role.muted}>Details: {failure.details}</Text>
    </Box>
  );
}

/**
 * Full-featured session conversation view for the terminal.
 *
 * Uses the headless {@link useSessionConversation} hook from
 * `@stigmer/react-core` to manage the complete conversation lifecycle,
 * then renders the thread and input using Ink terminal components.
 *
 * This is the main composition component that platform builders
 * drop into their Ink apps for a complete agent conversation UI.
 *
 * @example
 * ```tsx
 * import { InkStigmerProvider, createNodeClient, SessionView } from "@stigmer/ink-ui";
 *
 * const client = createNodeClient({ baseUrl: "...", apiKey: "..." });
 *
 * render(
 *   <InkStigmerProvider client={client}>
 *     <SessionView sessionId="ses_xxx" org="my-org" />
 *   </InkStigmerProvider>
 * );
 * ```
 */
export function SessionView(props: SessionViewProps) {
  return (
    <KeyOwnerProvider>
      <SessionViewBody {...props} />
    </KeyOwnerProvider>
  );
}

function SessionViewBody({
  sessionId,
  org,
  mode,
  canAnswer: canAnswerProp,
  approveDefault = "deny",
  approveSetting = 'approveDefault: "approve"',
  onTurnEnd,
  live = true,
  leaveHint,
  composer,
}: SessionViewProps) {
  const role = useRoles();
  const { exit } = useApp();
  const keysFree = useKeysFree();
  const { isRawModeSupported } = useStdin();
  const canAnswer = canAnswerProp ?? isRawModeSupported;
  const baseUrl = useStigmer().baseUrl;
  const watch = useContext(TurnWatchContext);
  const conv = useSessionConversation(sessionId, org);
  const [expandTools, setExpandTools] = useState(false);
  const [activeMode, setActiveMode] = useState<InteractionMode>(mode ?? "agent");
  const [settled, setSettled] = useState<readonly SettledAsk[]>([]);
  const settling = useRef(new Set<string>());
  const reported = useRef(new Set<string>());
  const [hasDraft, setHasDraft] = useState(false);
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [notes, setNotes] = useState<readonly ThreadNote[]>([]);

  useEffect(() => {
    if (mode) setActiveMode(mode);
  }, [mode]);

  const { isStoppable, stop } = conv;
  const stopTurn = useCallback(() => {
    void stop().catch(() => {
      // The stop's failure shows as the conversation's stopError below.
    });
  }, [stop]);

  // The first Ctrl+C's line stands for the leave window, then goes.
  useEffect(() => {
    if (!leaveArmed) return;
    const timer = setTimeout(() => setLeaveArmed(false), LEAVE_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [leaveArmed]);

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        // A draft is the composer's to clear.
        if (hasDraft) return;
        if (leaveArmed) exit();
        else setLeaveArmed(true);
        return;
      }
      if (leaveArmed) setLeaveArmed(false);
      if (key.ctrl && input === "o") {
        setExpandTools((e) => !e);
        return;
      }
      if (!keysFree) return;
      if (key.escape && isStoppable) {
        stopTurn();
        return;
      }
      if ((key.ctrl && input === "t") || (key.tab && key.shift)) {
        setActiveMode((m) => (m === "plan" ? "agent" : "plan"));
      }
    },
    { isActive: canAnswer },
  );

  const { sendFollowUp } = conv;
  const commandContext = useMemo<ComposerContext>(
    () => ({
      mode: activeMode,
      send: (text) => void sendFollowUp(text, { interactionMode: activeMode }),
      stop: stopTurn,
      note: (text) => setNotes((list) => [...list, { id: `note-${list.length}`, text }]),
      setMode: setActiveMode,
      leave: exit,
    }),
    [activeMode, sendFollowUp, stopTurn, exit],
  );

  // Off a terminal no one can answer: each ask is settled once, by the default.
  const { asks, answerToolUse } = conv;
  useEffect(() => {
    if (canAnswer || approveDefault === "leave") return;
    for (const ask of asks) {
      if (settling.current.has(ask.id)) continue;
      settling.current.add(ask.id);
      const approved = approveDefault === "approve";
      setSettled((list) => [...list, { id: ask.id, name: askName(ask), approved }]);
      void answerToolUse(ask.id, approved ? "allow" : "deny", approved ? undefined : NO_TERMINAL_DENIAL).catch(() => {
        // The answer's failure shows as the conversation's answerError below.
      });
    }
  }, [canAnswer, asks, answerToolUse, approveDefault]);

  // Each turn's end is heard once; a watching run (runInTerminal) sees every change.
  useEffect(() => {
    watch?.onTurns(conv.turns);
    for (const turn of conv.turns) {
      if (turn.status === undefined || !turn.ended || reported.current.has(turn.runId)) continue;
      reported.current.add(turn.runId);
      onTurnEnd?.(turn);
    }
  }, [conv.turns, onTurnEnd, watch]);

  useEffect(() => {
    if (conv.loadError) watch?.onLoadError(conv.loadError);
  }, [conv.loadError, watch]);

  if (conv.isLoading) {
    return (
      <Box gap={1} paddingLeft={1}>
        <Spinner style={role.accent} />
        <Text>Loading session...</Text>
      </Box>
    );
  }

  if (conv.loadError) {
    return <FailureBlock error={conv.loadError} baseUrl={baseUrl} step="load" />;
  }

  const activeTodos = conv.activeTurn?.todos ?? [];
  const reviewSet = conv.fileReviewSets[0];

  const subject = resolvedSubject(conv.session?.spec?.subject) ?? undefined;

  return (
    <Box flexDirection="column">
      {conv.isConnecting && (
        <Box gap={1} paddingLeft={1}>
          <Spinner style={role.accent} />
          <Text dimColor>Connecting to stream...</Text>
        </Box>
      )}

      {conv.isReconnecting && (
        <Box gap={1} paddingLeft={1}>
          <Spinner style={role.warning} />
          <Text dimColor>Reconnecting...</Text>
        </Box>
      )}

      {conv.streamError && <FailureBlock error={conv.streamError} baseUrl={baseUrl} step="stream" />}

      <MessageThread
        turns={conv.turns}
        runs={conv.runs}
        pendingUserMessage={conv.pendingUserMessage}
        queued={conv.queued}
        onAnswerToolUse={conv.answerToolUse}
        answeringToolUseIds={conv.answeringToolUseIds}
        expandToolCalls={expandTools}
        showFileReviewRecords
        canAnswer={canAnswer}
        live={live}
        subject={subject}
        notes={notes}
      />

      {settled.map((ask) => (
        <Box key={ask.id} paddingLeft={1}>
          <Text {...(ask.approved ? role.success : role.warning)}>
            {ask.approved
              ? `Approved ${ask.name} without asking (${approveSetting}).`
              : `Denied ${ask.name} — nobody at a terminal to approve it. Use ${approveSetting} to allow.`}
          </Text>
        </Box>
      ))}

      {activeTodos.length > 0 && (
        <Box marginY={1} paddingLeft={1}>
          <TodoList todos={activeTodos} />
        </Box>
      )}

      {conv.answerError && (
        <Box paddingLeft={1}>
          <Text {...role.danger}>
            Approval error: {conv.answerError.message}
          </Text>
        </Box>
      )}

      {conv.stopError && (
        <Box paddingLeft={1}>
          <Text {...role.danger}>
            Stop error: {conv.stopError.message}
          </Text>
        </Box>
      )}

      {conv.sendError && (
        <Box paddingLeft={1}>
          <Text {...role.danger}>
            Send error: {conv.sendError.message}
          </Text>
        </Box>
      )}

      <UsageWidget runs={conv.runs} />

      {/* Mid-turn live capture: the transient "N files changing…" strip
          for a still-running turn, covering shell-made changes with no tool row.
          Mutually exclusive with the FileReviewPrompt below — progress shows
          while the turn captures, the prompt once its changes are offered — so
          it hands off cleanly when review opens. Non-interactive; the per-file
          list reuses the existing Ctrl+O expand toggle. */}
      <FileChangeProgressBar
        progress={conv.fileChangeProgress}
        expanded={expandTools}
      />

      {reviewSet && (
        <Box flexDirection="column">
          <FileReviewPrompt
            fileReviewSet={reviewSet}
            capture={conv.fileChangeCaptures.get(reviewSet.changeSetId) ?? null}
            onSubmit={conv.reviewFileChanges}
            submittingDecisionKeys={conv.submittingFileDecisionKeys}
            decisionErrors={conv.fileDecisionErrors}
            // Single active decision surface: yield to a tool use that waits.
            isActive={canAnswer && conv.asks.length === 0}
          />
          {!canAnswer && (
            <Box paddingLeft={2}>
              <Text {...role.warning}>
                This review waits for a terminal: open the session where a person can decide.
              </Text>
            </Box>
          )}
          {conv.fileReviewSets.length > 1 && (
            <Box paddingLeft={2}>
              <Text dimColor>
                {conv.fileReviewSets.length - 1} more awaiting review
              </Text>
            </Box>
          )}
        </Box>
      )}

      {conv.fileReviewError && (
        <Box paddingLeft={1}>
          <Text {...role.danger}>
            File review error: {conv.fileReviewError.message}
          </Text>
        </Box>
      )}

      {live && conv.activePhase !== null && reviewSet === undefined && (
        // Just above the composer, as the one place a person looks while the
        // turn works. Not drawn while a set awaits review: review is not a
        // phase of the turn, and the FileReviewPrompt is the honest cue.
        <WorkingLine
          turn={conv.activeTurn}
          isSlow={conv.isSlow}
          isStopping={conv.isStopping}
          hint={canAnswer && conv.isStoppable ? (conv.isStopping ? "Esc again to end it now" : "Esc to stop") : undefined}
        />
      )}

      {conv.canSendFollowUp && canAnswer && (
        <Box paddingLeft={1}>
          <Text {...(activeMode === "plan" ? role.warning : role.muted)}>
            {activeMode === "plan"
              ? "Plan mode — read-only analysis, no file mutations"
              : "Agent mode — full tool access"}
          </Text>
        </Box>
      )}

      {canAnswer && (
        <FollowUpInput
          onSubmit={(message, attach) =>
            conv.sendFollowUp(message, { ...attach, interactionMode: activeMode })
          }
          isSubmitting={conv.isSending}
          disabled={!conv.canSendFollowUp}
          mode={activeMode}
          composer={composer}
          context={commandContext}
          onDraftChange={setHasDraft}
          escapeClears={!conv.isStoppable}
          hint={keyHint(activeMode)}
        />
      )}

      {leaveArmed && (
        <Box paddingLeft={1}>
          <Text {...role.warning}>{leaveLine(conv.activePhase !== null, leaveHint)}</Text>
        </Box>
      )}
    </Box>
  );
}

/** The composer's hint: the keys in effect. Esc is the working line's to name, while a turn works. */
function keyHint(mode: InteractionMode): string {
  return `Enter send · \\⏎ newline · Shift+Tab ${mode === "plan" ? "agent" : "plan"} mode · Ctrl+C leave · ? keys`;
}

/** What the agent reads when an ask is denied because no one could answer. */
const NO_TERMINAL_DENIAL = "No one could answer: the session ran without a terminal.";

/** A tool use's name as the line about it says it: its MCP server's, when it has one. */
function askName(ask: ToolUse): string {
  return ask.mcpServerName ? `${ask.mcpServerName}/${ask.name}` : ask.name;
}
