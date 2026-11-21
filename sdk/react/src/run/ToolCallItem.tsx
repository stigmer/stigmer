"use client";

import { memo, useMemo, type ReactNode } from "react";
import { failureWords, formatElapsed, isBackgroundRunning, searchCountWords, stepPhrase, type ToolUse } from "@stigmer/client";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { useIsTextTruncated } from "../internal/useIsTextTruncated.js";
import {
  ThreadCardShell,
  ThreadCardBody,
  ThreadCardStep,
  ThreadCardHeaderControl,
  type ThreadCardStepGesture,
  type ThreadCardVariant,
  SpinnerIcon,
  DoneTick,
  FailedGlyph,
  SlashCircleIcon,
} from "../internal/thread-card/index.js";
import { ToolCallDetail, formatHeaderDuration } from "./ToolCallDetail.js";
import { useElapsedSince } from "../internal/useElapsedSince.js";
import { hasResultBody, resultCounts, type ResultCounts } from "./ResultView.js";
import { ApprovalCardBody, ApprovalCardHeader } from "./ApprovalCard.js";
import { MemoryProposalCardBody } from "../memory/MemoryProposalCard.js";
import { useApproval, useWaitingWords } from "./ApprovalContext.js";
import { useThreadPresentation } from "./ThreadPresentationContext.js";
import { BackgroundCommandStatusWords, BackgroundCommandStop, BackgroundStopError } from "./BackgroundCommandStatus.js";
import { useBackgroundStop } from "./BackgroundCommandContext.js";
import { useFileReviewRowState } from "@stigmer/react-core";
import { CHANGE_WORDS } from "../session/turn-change-words.js";
import { FilePathLink } from "./FilePathLink.js";
import { sizeWords } from "../internal/size-words.js";
import { fileKind } from "../session/TurnOutcome.js";
import { splitDisplayPath } from "./file-path-resolver.js";
import { subagentSubjectOf } from "@stigmer/react-core";
import { isFileCategory, useFileReviewRowFile } from "@stigmer/react-core/internal";
import { type ToolCategory } from "@stigmer/react-core";
import { presentationWording, useToolPresentation } from "./tool-presenter.js";
import { StatusBadge } from "../status/StatusBadge.js";
import type { StatusPhase } from "../resource-workbench/types.js";
import { Tag } from "../internal/surface/Tag.js";
import { HELPER_STATE_WORDS, HelperEndingBadge, HelperGlyph, helperShowsWork, helperTagWord } from "./helper-step.js";
import { HelperMark, SubagentSection } from "./SubagentSection.js";
import { underOutputs, useOutputFileOpener } from "./OutputFileContext.js";
import { useStepPlace } from "./step-place.js";
import { holdsToolCard, toolCallInfoOf, useHasToolCard, useHostCard } from "./tool-card.js";
import { HostPartBoundary } from "../internal/HostPartBoundary.js";

/** Props for {@link ToolCallItem}. */
export interface ToolCallItemProps {
  /**
   * The tool use to render as a summary row (from the session's fold). A
   * tool use that started a subagent (`toolUse.thread`) renders its
   * {@link SubagentSection} as the detail panel instead of a
   * {@link ToolCallDetail}.
   */
  readonly toolUse: ToolUse;
  /**
   * Forces the detail panel open on first render regardless of the
   * auto-disclosure policy. Defaults to `false`.
   */
  readonly defaultExpanded?: boolean;
  /**
   * Whether the row renders as its own self-contained card (a thin rounded
   * border). Defaults to `true`. Set to `false` when the row is nested inside a
   * container that already provides the border — e.g. the folded
   * `ToolRunGroup` chip — where the row falls back to a divider-separated
   * row to avoid a card-in-a-card.
   */
  readonly bordered?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a single tool call as one step, as the session page draws a step
 * (S33 to S38): a mark, its words, a second line under them, its time on the
 * right; closed until clicked, opening in place, under its own words, to
 * what the step did.
 *
 * - **The mark** says how the step stands: the green tick once it is done
 *   (the owner's ruling of 2026-11-14 reverses stigmer#274's silent default:
 *   a finished step shows the tick, and its words go quiet beside it), the
 *   running spinner while it works or waits on someone else, a red (!) when
 *   it failed, a slash when it never ran (stopped with its turn, or denied).
 * - **The line** says what the call did, in the tense it stands in, from
 *   `stepPhrase` (`@stigmer/client`): "Editing invoice.ts" while it runs,
 *   "Edited invoice.ts" once it returned, "Couldn't edit invoice.ts" when it
 *   failed, "Created rounding.test.ts" for a write its turn's review says
 *   made the file. A command reads as the agent's own description when it
 *   wrote one; a connected app's tool reads as its own name with the app's
 *   mark after it. A host's `registerToolPresenter` label wins over all of
 *   it. A finished step's words are muted; a running or failed one's read at
 *   medium weight.
 * - **The second line** says what came of it and where: "+2 −2 ·
 *   src/billing", "2 matches in 2 files", "src/billing · 88 lines", a
 *   command (in mono), why a file step failed in a sentence, a File's kind
 *   and size, how a background command stands, whom a waiting step waits on.
 * - **Closed by default.** A settled step opens on a click to its body, in
 *   one quiet box (`STEP_INSET`): the diff, the lines read or written, the
 *   matches, the command's output, the MCP call's fields, a subagent's own
 *   steps. A step with nothing to show has no chevron. A File the turn wrote
 *   to its outputs folder opens the File itself, in the session's panel or
 *   window (the session view provides the opener), and has no chevron.
 * - **Open while it matters.** {@link useAutoDisclosure} opens a step while
 *   it runs in the foreground (a command shows its last lines as they
 *   print), while it waits for this viewer (its decision inline), and, for
 *   a command, once it failed; a manual click always wins thereafter. A
 *   command left running in the background stays closed until clicked.
 * - **Preview** (a memory proposal, or a kind a host asks to preview): the
 *   body is always in view under the line, because it is a decision surface.
 * - **A host's own card** (`toolCards` on `StigmerProvider`, keyed by the
 *   call's public name): it draws the body in every state, open by default
 *   and never folded away, while the line, its mark, any approval and any
 *   failure stay the kit's. A card that throws gives the body back to the
 *   kit. Inside a finished turn's "How it got there" the card is drawn
 *   above the fold instead, and the row draws the kit's body.
 *
 * Inside a list of steps (`bordered={false}`) a step is a divider row; on a
 * to-do's or a helper's rail it is an undivided row, a helper's steps
 * leaving their time to the helper. On its own it is a card, or a quiet
 * unboxed line for the metadata-only kinds (read, list, search, think)
 * unless it waits or failed. A call waiting for this viewer is the approval
 * itself, one card in the gate's accent.
 *
 * A call that started a helper (`toolUse.thread`) draws the helper's line:
 * its subject (first letter capitalised), its agent's name as a tag with the
 * helper glyph, its time, and a pill only once the helper failed or stopped;
 * the body is the helper's own steps on a rail ({@link SubagentSection}'s
 * flat form).
 *
 * Wrapped in `React.memo` — the session fold keeps an unchanged tool use's
 * reference, so a settled row skips re-renders while sibling tools stream.
 *
 * @example
 * ```tsx
 * import type { ToolUse } from "@stigmer/client";
 *
 * function Step({ toolUse }: { toolUse: ToolUse }) {
 *   return <ToolCallItem toolUse={toolUse} />;
 * }
 * ```
 */
export const ToolCallItem = memo(function ToolCallItem({
  toolUse,
  defaultExpanded = false,
  bordered = true,
  className,
}: ToolCallItemProps) {
  useRenderTracer("ToolCallItem", { status: toolUse.state, id: toolUse.id });

  const place = useStepPlace();
  // A background command still running keeps the row live though its call
  // returned: the call and the command are two facts, and the row shows the
  // one still moving.
  const backgroundRunning = isBackgroundRunning(toolUse);
  const toolPresentation = useToolPresentation(toolUse);
  const { category, title, phrase, primaryArg, result, resultSummary, disclosure, chrome } = toolPresentation;
  // Which words are a host presenter's own: one that threw, or a blank
  // label, left the kit's words.
  const wording = presentationWording(toolPresentation);
  // A command that exited non-zero, or an edit the harness refused, failed
  // though the engine did not mark it an error: its line, its mark and its
  // open default all say so.
  const failed = phrase.tense === "failed" && toolUse.state !== "denied";
  const status: ItemStatus = backgroundRunning
    ? "running"
    : toolUse.state === "denied"
      ? "denied"
      : failed
        ? "failed"
        : ITEM_STATUS[toolUse.state];
  const isRunning = status === "running";
  const settledDuration = formatHeaderDuration(toolUse.processedAt, toolUse.result?.processedAt ?? "");
  const thread = toolUse.thread;
  const isSubagent = thread !== undefined;
  const hostLabel = wording.hostLabel;

  // The decision for this exact call when it waits for a person (parent or
  // nested subagent), or null. Drives the inline approval panel and forces
  // the row open. None where the thread answers the ask in its own card:
  // the decision is drawn once, there.
  const offered = useApproval(toolUse);
  const presentation = useThreadPresentation();
  const carded = presentation.cardedAsks?.has(toolUse.id) === true;
  const approval = carded ? null : offered;
  // A step waiting with no decision on its row (one on a person this viewer
  // is not, or one answered in its own card): drawn running, its line
  // saying whom it waits on.
  const waitingWords = useWaitingWords();
  const waitsWithoutDecision = status === "waiting" && approval == null;
  // A step at work now: a call running or waiting on someone else, or a
  // helper still working (its mark follows the helper, so its band does).
  const live = isSubagent ? thread.state === "running" : isRunning || waitsWithoutDecision;

  // A failed command stays open: its output is the content the person needs
  // next.
  const tailFailed = !isSubagent && disclosure === "tail" && failed;

  // The host's own card for this call (`toolCards` on the provider): it
  // draws the body in every state, under our line, open by default and kept
  // in view. Inside a finished turn's fold the card is drawn above the fold
  // instead, and this row draws our body.
  const hostCard = useHostCard(toolUse);
  const HostCard = isSubagent ? undefined : hostCard;
  const sessionId = presentation.sessionId ?? "";
  const cardCall = useMemo(() => (HostCard === undefined ? undefined : toolCallInfoOf(toolUse, sessionId)), [HostCard, toolUse, sessionId]);
  // A helper holding a step with a host card, at any depth, stays open after
  // it stops running.
  const hasCard = useHasToolCard();
  const helperShowsCard = isSubagent && holdsToolCard(toolUse, hasCard);

  // What the step opens to. A running command opens to what it printed so
  // far, once it has printed something; a running call of another kind has
  // nothing to show until it returns. A command left running in the
  // background has its output to show, but stays closed until clicked: it is
  // not the step in hand.
  const foregroundLive = isRunning && !backgroundRunning && category === "shell" && toolUse.liveOutput !== "";
  const failedEdit = failed && category === "edit";
  const hasBody =
    (isSubagent && helperShowsWork(thread)) ||
    approval != null ||
    result.type === "memoryProposal" ||
    foregroundLive ||
    backgroundRunning ||
    failedEdit ||
    cardCall !== undefined ||
    (toolUse.result !== undefined && hasResultBody(result));
  // A Stop that failed opens the row again if it was closed, since the
  // reason sits in its body.
  const stopFailed = useBackgroundStop(toolUse)?.error != null;
  const autoOpen = (isRunning && !backgroundRunning && hasBody) || approval != null || tailFailed || stopFailed || cardCall !== undefined || helperShowsCard;
  const [expanded, handleToggle] = useAutoDisclosure(autoOpen, {
    initialOpen: defaultExpanded || autoOpen,
  });

  // What the turn did to a written file, from its file review: a write that
  // made the file reads "Created". With review off nothing says so, and it
  // reads "Wrote".
  const reviewFile = useFileReviewRowFile(toolUse.runId, category === "write" ? primaryArg : null);
  const created = reviewFile?.change === "added";

  // Subagents title the row with their subject, its first letter
  // capitalised; every other row with its step line (a host's label, else
  // `stepPhrase`, "Created" where the review says so).
  const subject = isSubagent ? subagentSubjectOf(toolUse) : "";
  const displayLabel = isSubagent
    ? capitalised(subject) || thread.agentName || title
    : created && !hostLabel
      ? stepPhrase(toolUse, { created: true }).text
      : title;
  // A helper's row carries its agent's name as a tag beside the subject, and
  // its ending as a pill.
  const helperTag = isSubagent ? helperTagWord(thread.agentName, displayLabel) : null;

  const approvalBadge = getApprovalBadge(toolUse);

  // A file edit says only what changed it since: Undone, or Couldn't undo
  // (its turn's file review, matched by the row's path). A kept or
  // undecided edit says nothing: it is in place, which is what an edit is.
  const reviewState = useFileReviewRowState(toolUse.runId, isFileEditCategory(category) ? primaryArg : null);

  // A file step names its file in its line; the name is the file's own
  // control (it opens the file, or copies its path), so the line reads
  // "Edited invoice.ts" with "invoice.ts" pressable. A host's label, or a
  // name the line had to cut short, keeps the plain words.
  const fileName = !isSubagent && primaryArg != null && isFileCategory(category) ? splitDisplayPath(primaryArg).base : "";
  const linkedFile = fileName !== "" && displayLabel.endsWith(` ${fileName}`);
  const verb = linkedFile ? displayLabel.slice(0, displayLabel.length - fileName.length - 1) : displayLabel;

  // A File the turn wrote to its outputs folder says what it is and how big,
  // and where it opens; its row opens the File itself where the session can.
  const opener = useOutputFileOpener();
  const outputWords = !failed && category === "write" && primaryArg != null ? outputFileWords(primaryArg, toolUse) : "";
  const opensOutput = outputWords !== "" && opener !== null && primaryArg != null && opener.hasOutputPath(primaryArg);

  // The second line: what came of the step, and where (drawn below, once
  // the counts it reads are known).
  function secondLine(): ReactNode {
    const parts: ReactNode[] = [];
    if (failed && isFileCategory(category) && toolUse.result !== undefined) {
      const reason = failureWords(toolUse.result.text);
      if (reason !== "") return reason;
    }
    if (outputWords !== "") {
      return opensOutput && opener !== null ? `${outputWords} · opens in ${opener.opensIn === "panel" ? "the panel" : "a window"}` : outputWords;
    }
    if (category === "shell" && toolUse.background !== undefined) {
      return <BackgroundCommandStatusWords toolUse={toolUse} />;
    }
    if (category === "shell" || category === "background-stop" || category === "unknown") {
      if (primaryArg === null) return null;
      return category === "shell" ? <span className="stg:font-mono stg:text-foreground">{primaryArg}</span> : primaryArg;
    }
    if (category === "mcp") {
      const answer = toolUse.result !== undefined && !failed ? oneLineAnswer(toolUse.result.text) : "";
      if (primaryArg !== null) parts.push(`“${primaryArg}”`);
      if (answer !== "") parts.push(answer);
      if (waitsWithoutDecision) parts.push(waitingWords);
      return joinParts(parts);
    }
    if (hostSummary !== null) parts.push(<span key="summary" className="stg:tabular-nums">{hostSummary}</span>);
    else if (counts?.kind === "lines") {
      parts.push(
        <span key="lines" className="stg:font-mono stg:tabular-nums">
          <span className="stg:text-status-ready">+{counts.added}</span>
          {!(category === "write" && counts.removed === 0) && (
            <>
              {" "}
              <span className="stg:text-status-failed">{"−"}{counts.removed}</span>
            </>
          )}
        </span>,
      );
    } else if (counts?.kind === "count") parts.push(counts.text);
    if (phrase.folder !== "") parts.push(phrase.folder);
    if (category === "read" && result.type === "file" && result.range?.total !== undefined) parts.push(`${result.range.total} lines`);
    if (created) parts.push("new file");
    if (waitsWithoutDecision) parts.push(waitingWords);
    return joinParts(parts);
  }
  // A host's registered summary (`registerToolPresenter({ summary })`) is
  // its own words for the counts, shown in their place.
  const hostSummary = !isSubagent && wording.hostSummary ? resultSummary : null;
  const counts = isSubagent || toolUse.result === undefined || hostSummary !== null ? null : stepCounts(result, category);
  const countsText = hostSummary ?? (counts === null ? null : countsWords(counts));
  // The text the second line may cut short, for the toggle's hint.
  const detailText = category === "shell" || category === "background-stop" || category === "unknown" || category === "mcp" ? primaryArg : phrase.folder || null;
  const { ref: detailRef, isTruncated: detailTruncated } = useIsTextTruncated<HTMLSpanElement>(detailText !== null);
  const detail = isSubagent ? null : secondLine();

  const gateAccent = approval != null ? (category === "delete" ? "destructive" : "warning") : null;
  // The chrome tier (the density axis, stigmer#274): inside a list of steps
  // every step is a divider row, on a rail an undivided one; on its own a
  // metadata-only step is a quiet line until it waits or fails.
  const variant: ThreadCardVariant =
    place.rows === "rail"
      ? "quiet"
      : !bordered
        ? "row"
        : chrome === "quiet" && !isSubagent && approval == null && !failed
          ? "quiet"
          : "card";

  // The exit code a failed command ended with, once, after its words.
  const exitTag = counts?.kind === "exit" ? <ExitTag code={counts.code} /> : null;

  // A command in the background names its command in its line (its second
  // line says how it stands).
  const backgroundCommand = category === "shell" && toolUse.background !== undefined && primaryArg !== null ? primaryArg : null;

  const titleWords = (
    <>
      {/* A step at work reads bright, as a failed one does: the drawing's
          live step (the session page, S38 and S48) sets its words at the
          foreground on the running band, the spinner saying it moves. The
          liveness sweep stays on the quiet lines (Thinking, the turn's
          status line). A finished step's words go quiet. */}
      <span className={live || failed ? "stg:text-foreground" : "stg:text-muted-foreground"}>
        {linkedFile && primaryArg ? (
          <>
            {verb}{" "}
            {/* Its own control, beside the row's toggle rather than inside it. */}
            <ThreadCardHeaderControl className="stg:inline-flex stg:max-w-full stg:align-bottom">
              <FilePathLink path={primaryArg} className="stg:min-w-0 stg:font-sans stg:text-sm" />
            </ThreadCardHeaderControl>
          </>
        ) : (
          // The space before what follows is the words' own, as the drawing
          // sets it, so the line reads as one run of words.
          `${displayLabel}${backgroundCommand !== null || helperTag !== null ? " " : ""}`
        )}
      </span>
      {backgroundCommand !== null && <span className="stg:font-mono stg:text-xs stg:text-muted-foreground">{backgroundCommand}</span>}
      {helperTag !== null && (
        <Tag>
          <HelperGlyph />
          {helperTag}
        </Tag>
      )}
      {phrase.app !== "" && !isSubagent && <AppMark app={phrase.app} />}
      {exitTag}
    </>
  );

  const showTime = !place.inHelper;
  const trail = (
    <>
      {approvalBadge && <StatusBadge phase={approvalBadge.phase} label={approvalBadge.label} />}

      {(reviewState === "discarded" || reviewState === "failed") && (
        <span className="stg:inline-flex stg:shrink-0" data-cursor-target="file-review-row-badge">
          {reviewState === "discarded" ? <Tag>{CHANGE_WORDS.undone}</Tag> : <StatusBadge phase="failed" label={CHANGE_WORDS.undoFailed} />}
        </span>
      )}

      {isSubagent && <HelperEndingBadge state={thread.state} />}

      <BackgroundCommandStop toolUse={toolUse} />

      {/* A background command's own line already says its time. */}
      {showTime &&
        (isRunning && !backgroundRunning ? (
          <RunningTime startedAt={toolUse.processedAt} />
        ) : (
          settledDuration && !backgroundRunning && <span className={TIME_CLASSES}>{settledDuration}</span>
        ))}
    </>
  );

  // The host's card in place of our detail, which comes back if the card
  // throws.
  function withHostCard(ours: ReactNode): ReactNode {
    if (cardCall === undefined || HostCard === undefined) return ours;
    return (
      // A card that threw while its call ran tries again once the call's
      // state moves (its result landed).
      <HostPartBoundary resetKey={cardCall.state} fallback={ours}>
        <HostCard call={cardCall} />
      </HostPartBoundary>
    );
  }

  // The disclosed body: a pending gate decides inline, a subagent shows its
  // own steps, a settled remember call renders the memory-proposal consent
  // surface, a host's own card where it registered one, otherwise the
  // category detail.
  const body = isSubagent ? (
    <SubagentSection
      thread={thread}
      subject={subject}
      startedAt={toolUse.processedAt}
      completedAt={toolUse.result?.processedAt}
      collapsible={false}
    />
  ) : approval ? (
    // The row above is this approval's header, so render only the body (its
    // sentence + actions). The enclosing card carries the accent. The body
    // reads the proposed write content from the tool's input, which the
    // ask's sanitized preview cannot carry for a file of any real size
    // (stigmer#1107).
    <ApprovalCardBody toolUse={approval.toolUse} onAnswer={approval.onAnswer} isSubmitting={approval.isSubmitting} error={approval.error} />
  ) : result.type === "memoryProposal" ? (
    // The remember tool's consent chip: verbatim fact + Confirm/Reject, with
    // the record's CURRENT lifecycle fetched so a reloaded thread never
    // shows stale action buttons. Borderless — this row's card owns the
    // chrome (the ApprovalCardBody posture).
    <MemoryProposalCardBody memoryId={result.memoryId} fact={result.fact} />
  ) : (
    withHostCard(
      <>
        <BackgroundStopError toolUse={toolUse} />
        {/* A search or listing whose line had to cut its pattern restates it whole. */}
        <ToolCallDetail
          toolUse={toolUse}
          primaryArgTruncated={(category === "search" || category === "list") && primaryArg != null && !displayLabel.includes(primaryArg)}
        />
      </>,
    )
  );

  // A helper's mark follows the helper, not its call: running while it works
  // though its call is open, its own ending once it ended.
  const mark = isSubagent ? <HelperMark state={thread.state} /> : <StepMark status={status} />;
  const stepPlace = place.rows === "rail" ? "rail" : "card";

  // A call waiting for this viewer's answer is the approval itself while it
  // waits: the ask's own head (what the agent wants, and what it would
  // touch) over its decision, one object in the gate's accent, never a step
  // line beside a card. Once answered it is a step line again.
  if (approval != null) {
    return (
      <ThreadCardShell variant="card" accent={gateAccent} cursorTarget="tool-call-row" className={className}>
        <div role="alert" aria-label={`Approval required for ${toolUse.name}`}>
          <ApprovalCardHeader toolUse={approval.toolUse} bordered />
          <ThreadCardBody cursorTarget="tool-preview">{body}</ThreadCardBody>
        </div>
      </ThreadCardShell>
    );
  }

  const step = (gesture: ThreadCardStepGesture, shown: ReactNode) => {
    const row = (
    <ThreadCardShell variant={variant} accent={gateAccent} cursorTarget="tool-call-row" className={className}>
      <ThreadCardStep
        gesture={gesture}
        place={stepPlace}
        mark={mark}
        title={titleWords}
        // A step at work, waiting on someone or failed is news: its line at
        // medium weight; a finished one quiet.
        titleClassName={live || failed ? "stg:font-medium" : undefined}
        detail={detail}
        detailRef={detailRef}
        trail={trail}
        body={shown}
        bodySpan={isSubagent ? "rail" : "words"}
        bodyCursorTarget="tool-preview"
        // The step at work sits on the running band, as the drawing's live
        // step does, with what it opened to: in a card of steps, or on a
        // to-do's rail, so only what runs is lit. A helper's own steps stay
        // clear: the helper's band holds them.
        band={live && !place.inHelper}
      />
    </ThreadCardShell>
    );
    // A helper's row is named with its state, so a screen reader hears what
    // a sighted person reads from its mark or its pill.
    return isSubagent ? (
      <div role="group" aria-label={`Subagent: ${displayLabel}, ${HELPER_STATE_WORDS[thread.state]}`}>
        {row}
      </div>
    ) : (
      row
    );
  };

  // Preview: the line above an always-visible body (a decision surface, or
  // a kind a host asks to preview).
  if (!isSubagent && disclosure === "preview" && hasBody) return step({ kind: "none" }, body);

  // A File the turn returned: the line opens the File.
  if (opensOutput && opener !== null && primaryArg !== null) {
    const path = primaryArg;
    return step({ kind: "open", onOpen: () => opener.openOutputPath(path), label: `Open ${fileName || displayLabel}` }, undefined);
  }

  // Nothing to open: the line is the whole step.
  if (!hasBody) return step({ kind: "none" }, undefined);

  // The toggle's name says what the row is, from the line's own words.
  return step(
    {
      kind: "expand",
      expanded,
      onToggle: handleToggle,
      label: toggleLabel(backgroundCommand !== null ? `${displayLabel} ${backgroundCommand}` : displayLabel, detailText, isSubagent ? helperTag : countsText),
      ...(detailText !== null && detailTruncated ? { hint: detailText } : {}),
    },
    expanded ? body : undefined,
  );
});

/** A step's time on the right: 12/16 meta, its digits aligned. */
const TIME_CLASSES = "stg:shrink-0 stg:text-xs stg:tabular-nums stg:text-muted-foreground";

/** The parts of a second line, as one run of words joined by a quiet dot ("+2 −2 · src/billing"). */
function joinParts(parts: readonly ReactNode[]): ReactNode {
  if (parts.length === 0) return null;
  return parts.flatMap((part, at) => (at === 0 ? [part] : [" · ", part]));
}

/** A string with its first letter capitalised, for display; the value itself stays as written. */
function capitalised(text: string): string {
  return text === "" ? "" : text.charAt(0).toUpperCase() + text.slice(1);
}

/** A connected app's answer when it is one short line ("No open issues match."), else "". */
function oneLineAnswer(text: string): string {
  const trimmed = text.trim();
  return trimmed !== "" && !trimmed.includes("\n") && trimmed.length <= 80 && !trimmed.startsWith("{") && !trimmed.startsWith("[") ? trimmed : "";
}

/** A step's counts: a search's as `searchCountWords` says them, else the result's own. */
function stepCounts(view: ReturnType<typeof useToolPresentation>["result"], category: ToolCategory): ResultCounts | null {
  if (view.type === "search") return { kind: "count", text: searchCountWords(view) };
  return resultCounts(view, category === "write");
}

/** The exit code a failed command ended with: one mono tag in the failed hue, after its words. */
function ExitTag({ code }: { readonly code: number }) {
  return (
    <span className="stg:ml-1.5 stg:inline-flex stg:rounded stg:bg-status-failed-subtle stg:px-1.5 stg:align-[1px] stg:font-mono stg:text-2xs stg:leading-4 stg:text-status-failed">
      exit {code}
    </span>
  );
}

/** A connected app's quiet mark after its tool's name: its initial in a 16px square, then its slug. */
function AppMark({ app }: { readonly app: string }) {
  return (
    <span className="stg:ml-2 stg:inline-flex stg:items-center stg:gap-1 stg:align-[-2px] stg:text-xs stg:text-muted-foreground">
      <span
        aria-hidden="true"
        className="stg:flex stg:h-4 stg:w-4 stg:items-center stg:justify-center stg:rounded stg:bg-primary stg:text-2xs stg:font-semibold stg:leading-4 stg:text-primary-foreground"
      >
        {app.charAt(0).toUpperCase()}
      </span>
      <span>{app}</span>
    </span>
  );
}

/** The leading mark of a step, from how it stands (see the component's doc). */
function StepMark({ status }: { readonly status: ItemStatus }) {
  switch (status) {
    case "completed":
      return <DoneTick />;
    case "running":
    case "waiting":
      return (
        <span className="stg:flex stg:text-status-running" aria-hidden="true">
          <SpinnerIcon size={12} />
        </span>
      );
    case "failed":
      return (
        <span className="stg:flex stg:text-status-failed" aria-hidden="true">
          <FailedGlyph />
        </span>
      );
    case "interrupted":
    case "denied":
      return <SlashMark />;
  }
}

/** The mark of a step that never ran to its end: a muted slashed circle. */
function SlashMark() {
  return (
    <span className="stg:flex stg:text-muted-foreground" aria-hidden="true">
      <SlashCircleIcon />
    </span>
  );
}

/** A File written to the outputs folder in words, its kind and size ("Markdown · 4.1 KB"); "" for any other path. */
function outputFileWords(path: string, toolUse: ToolUse): string {
  const saved = underOutputs(path);
  if (saved === undefined) return "";
  const content = toolUse.input["content"];
  const size = typeof content === "string" ? sizeWords(new TextEncoder().encode(content).length) : (/\b(\d+(?:\.\d+)?\s?[KMG]?B)\b/.exec(toolUse.result?.text ?? "")?.[1] ?? "");
  const kind = fileKind(saved, "");
  return size === "" ? kind : `${kind} · ${size}`;
}

/** A running step's time, counted live from its start; nothing under a second. */
function RunningTime({ startedAt }: { readonly startedAt: string }) {
  const elapsed = useElapsedSince(startedAt);
  if (elapsed === null || elapsed < 1000) return null;
  return <span className={TIME_CLASSES}>{formatElapsed(elapsed)}</span>;
}

/** Counts as words, for the toggle's name: "+2 −2", "exit 1", "2 matches". */
function countsWords(counts: ResultCounts): string {
  switch (counts.kind) {
    case "lines":
      return `+${counts.added} −${counts.removed}`;
    case "exit":
      return `exit ${counts.code}`;
    case "count":
      return counts.text;
  }
}

/**
 * The name of a row's toggle: "Edited invoice.ts src/billing, +2 −2",
 * "Searched for round( in src/billing, 2 matches", "Ran a command npm test".
 * Spoken in place of the line's text, so it carries what the line says about
 * the call; status and duration stay readable beside it.
 */
function toggleLabel(title: string, detail: string | null, summary: string | null): string {
  const named = detail ? `${title} ${detail}` : title;
  return summary ? `${named}, ${summary}` : named;
}

// ---------------------------------------------------------------------------
// Approval badge
// ---------------------------------------------------------------------------

interface ApprovalBadgeInfo {
  readonly label: string;
  readonly phase: StatusPhase;
}

/**
 * How a person answered a call that asked: Approved (an allow, or a grant
 * given on this call) or Denied. A call that never asked, or still waits,
 * shows no badge.
 */
function getApprovalBadge(toolUse: ToolUse): ApprovalBadgeInfo | null {
  if (toolUse.ask === undefined) return null;
  if (toolUse.confirmation?.result === "deny") {
    return { label: "Denied", phase: "failed" };
  }
  if (toolUse.confirmation?.result === "allow" || toolUse.grant !== undefined) {
    return { label: "Approved", phase: "ready" };
  }
  return null;
}

/** Whether a category's row edits a file, the rows a file review badges. */
function isFileEditCategory(category: ToolCategory): boolean {
  return category === "write" || category === "edit" || category === "delete";
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

type ItemStatus = "running" | "waiting" | "failed" | "completed" | "interrupted" | "denied";

/**
 * The row's status from the tool use's state. A denied call never ran (its
 * badge says Denied), so it takes the slash, as a call its turn stopped
 * before it returned does (interrupted, issue #207): not a spinner (nothing
 * runs), not a failure (the tool never errored).
 */
const ITEM_STATUS: Record<ToolUse["state"], ItemStatus> = {
  running: "running",
  waiting: "waiting",
  failed: "failed",
  completed: "completed",
  denied: "denied",
  stopped: "interrupted",
};

// ---------------------------------------------------------------------------
// Category-specific icons (inline SVG, SDK pattern)
// ---------------------------------------------------------------------------

export const CATEGORY_ICON: Record<ToolCategory, () => React.JSX.Element> = {
  shell: TerminalIcon,
  read: FileIcon,
  write: FilePenIcon,
  edit: FilePenIcon,
  delete: TrashIcon,
  search: SearchIcon,
  list: FolderIcon,
  fetch: GlobeIcon,
  "web-search": GlobeIcon,
  think: BrainIcon,
  "subagent": HelperGlyph,
  internal: WrenchIcon,
  mcp: McpPlugIcon,
  memory: BookmarkIcon,
  "background-stop": StopSquareIcon,
  skill: BookIcon,
  unknown: WrenchIcon,
};

function BookIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2.5a1 1 0 0 1 1-1h6.5v8H3a1 1 0 0 0-1 1z" />
      <path d="M2 10.5a1 1 0 0 1 1-1h6.5v1.5H3a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function StopSquareIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11L6 8.5L3 11V2.5C3 1.95 3.45 1.5 4 1.5H8C8.55 1.5 9 1.95 9 2.5V11Z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M1.5 6H10.5" />
      <path d="M6 1.5C7.5 3 7.5 9 6 10.5C4.5 9 4.5 3 6 1.5Z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1.5" width="10" height="9" rx="1.5" />
      <path d="M3 4.5L5 6.5L3 8.5" />
      <path d="M6.5 8.5H9" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1H3C2.45 1 2 1.45 2 2V10C2 10.55 2.45 11 3 11H9C9.55 11 10 10.55 10 10V4L7 1Z" />
      <path d="M7 1V4H10" />
    </svg>
  );
}

function FilePenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1H3C2.45 1 2 1.45 2 2V10C2 10.55 2.45 11 3 11H9C9.55 11 10 10.55 10 10V4L7 1Z" />
      <path d="M7 1V4H10" />
      <path d="M5 7L8 7" />
      <path d="M5 9L7 9" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3H10" />
      <path d="M3 3V10C3 10.55 3.45 11 4 11H8C8.55 11 9 10.55 9 10V3" />
      <path d="M4.5 1H7.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="5.5" r="3.5" />
      <path d="M8 8L10.5 10.5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 3V9.5C1.5 10.05 1.95 10.5 2.5 10.5H9.5C10.05 10.5 10.5 10.05 10.5 9.5V4.5C10.5 3.95 10.05 3.5 9.5 3.5H6L5 2H2.5C1.95 2 1.5 2.45 1.5 3Z" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2C4.9 2 4 2.9 4 4C3.17 4 2.5 4.67 2.5 5.5C2.5 6.33 3 6.87 3 6.87C2.5 7.37 2.5 8.13 3 8.63C3.5 9.13 4.3 9.13 4.8 8.63L6 7.5" />
      <path d="M6 2C7.1 2 8 2.9 8 4C8.83 4 9.5 4.67 9.5 5.5C9.5 6.33 9 6.87 9 6.87C9.5 7.37 9.5 8.13 9 8.63C8.5 9.13 7.7 9.13 7.2 8.63L6 7.5" />
      <path d="M6 7.5V11" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 2C7.67 2 7 2.67 7 3.5C7 3.78 7.08 4.04 7.22 4.26L3.74 7.74C3.52 7.6 3.27 7.5 3 7.5C2.17 7.5 1.5 8.17 1.5 9C1.5 9.83 2.17 10.5 3 10.5C3.83 10.5 4.5 9.83 4.5 9C4.5 8.73 4.4 8.48 4.26 8.26L7.74 4.78C7.96 4.92 8.22 5 8.5 5C9.33 5 10 4.33 10 3.5C10 3.22 9.92 2.96 9.78 2.74L8.5 4L7.5 3L8.76 1.72C8.54 1.58 8.28 1.5 8 1.5" />
    </svg>
  );
}

function McpPlugIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 1.5V4" />
      <path d="M8 1.5V4" />
      <path d="M2.5 4H9.5V6.5C9.5 8.43 7.93 10 6 10C4.07 10 2.5 8.43 2.5 6.5V4Z" />
      <path d="M6 10V11" />
    </svg>
  );
}
