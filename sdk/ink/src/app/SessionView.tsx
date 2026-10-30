// The terminal session view: a session's conversation (its turns, read from
// the session's events) with the live turn's phase, to-dos and usage, the
// mid-turn file progress, the docked file-review decision, and the follow-up
// input with its agent/plan mode.
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
import React, { useState, useEffect, useRef, useContext } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import Spinner from "ink-spinner";
import { resolvedSubject, PENDING_SUBJECT, type Turn, type ToolUse } from "@stigmer/client";
import { useSessionConversation, useStigmer, runPhaseOf } from "@stigmer/react-core";
import { MessageThread } from "../components/MessageThread.js";
import { TodoList } from "../components/TodoList.js";
import { FollowUpInput } from "../components/FollowUpInput.js";
import { UsageWidget } from "../components/UsageWidget.js";
import { RunProgress } from "../components/RunProgress.js";
import { FileChangeProgressBar } from "../components/FileChangeProgressBar.js";
import { FileReviewPrompt } from "../components/FileReviewPrompt.js";
import { useRoles } from "../theme.js";
import { describeConnectionFailure, type FailedStep } from "../errors.js";
import { TurnWatchContext } from "./turn-watch.js";

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
export function SessionView({
  sessionId,
  org,
  mode,
  canAnswer: canAnswerProp,
  approveDefault = "deny",
  onTurnEnd,
  live = true,
}: SessionViewProps) {
  const role = useRoles();
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

  useEffect(() => {
    if (mode) setActiveMode(mode);
  }, [mode]);

  useInput(
    (input, key) => {
      if (key.ctrl && input === "o") {
        setExpandTools((e) => !e);
      }
      if (key.ctrl && input === "t") {
        setActiveMode((m) => (m === "plan" ? "agent" : "plan"));
      }
    },
    { isActive: canAnswer },
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
        <Text {...role.accent}>
          <Spinner type="dots" />
        </Text>
        <Text>Loading session...</Text>
      </Box>
    );
  }

  if (conv.loadError) {
    return <FailureBlock error={conv.loadError} baseUrl={baseUrl} step="load" />;
  }

  const activeTodos = conv.activeTurn?.todos ?? [];
  const reviewSet = conv.fileReviewSets[0];

  const subject = resolvedSubject(conv.session?.spec?.subject);

  return (
    <Box flexDirection="column">
      {subject && subject !== PENDING_SUBJECT && (
        <Box paddingLeft={1} marginBottom={1}>
          <Text dimColor bold>{subject}</Text>
        </Box>
      )}

      {conv.isConnecting && (
        <Box gap={1} paddingLeft={1}>
          <Text {...role.accent}>
            <Spinner type="dots" />
          </Text>
          <Text dimColor>Connecting to stream...</Text>
        </Box>
      )}

      {conv.isReconnecting && (
        <Box gap={1} paddingLeft={1}>
          <Text {...role.warning}>
            <Spinner type="dots" />
          </Text>
          <Text dimColor>Reconnecting...</Text>
        </Box>
      )}

      {conv.streamError && <FailureBlock error={conv.streamError} baseUrl={baseUrl} step="stream" />}

      {conv.activePhase !== null && reviewSet === undefined && (
        // Suppressed while a set awaits review: review is not a phase of the
        // turn, so the phase would otherwise read as an active "Running"
        // spinner while the agent is idle awaiting the reviewer — the
        // FileReviewPrompt is the honest cue.
        <RunProgress phase={runPhaseOf(conv.activePhase)} />
      )}

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
      />

      {settled.map((ask) => (
        <Box key={ask.id} paddingLeft={1}>
          <Text {...(ask.approved ? role.success : role.warning)}>
            {ask.approved
              ? `Approved ${ask.name}: no terminal to ask on (approveDefault is approve)`
              : `Denied ${ask.name}: no terminal to ask on (set approveDefault to approve)`}
          </Text>
        </Box>
      ))}

      {activeTodos.length > 0 && (
        <Box marginTop={1} paddingLeft={1}>
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
          onSubmit={(message) =>
            conv.sendFollowUp(message, { interactionMode: activeMode })
          }
          isSubmitting={conv.isSending}
          disabled={!conv.canSendFollowUp}
          mode={activeMode}
        />
      )}
    </Box>
  );
}

/** What the agent reads when an ask is denied because no one could answer. */
const NO_TERMINAL_DENIAL = "No one could answer: the session ran without a terminal.";

/** A tool use's name as the line about it says it: its MCP server's, when it has one. */
function askName(ask: ToolUse): string {
  return ask.mcpServerName ? `${ask.mcpServerName}/${ask.name}` : ask.name;
}
