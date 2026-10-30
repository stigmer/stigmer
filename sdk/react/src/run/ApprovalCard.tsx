"use client";

import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { resolveToolKind, type ToolUse } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import {
  describeApprovalPolicySource,
  hookApproveAllLabel,
  isInformativePolicySource,
} from "./approval-provenance.js";
import { resolveToolCategoryFromCall, extractShellIntentFromPreview } from "@stigmer/react-core";
import {
  extractPrimaryArgFromPreview,
  extractWriteContentFromArgs,
  isFileCategory,
  parseArgsPreview,
  withAuthoritativeWriteContent,
} from "@stigmer/react-core/internal";
import { type ToolCategory } from "@stigmer/react-core";
import { CATEGORY_ICON } from "./ToolCallItem.js";
import { ToolArgsView } from "./ToolArgsView.js";
import { EmptyChangeNotice } from "./EmptyChangeNotice.js";
import { FilePathLink } from "./FilePathLink.js";
import { DecisionButton } from "../internal/DecisionButton.js";
import { InCardDecisionError } from "../internal/InCardDecisionError.js";
import { INPUT_CLASSES } from "../internal/form-primitives.js";
import { useElapsedSince, formatElapsed } from "../internal/useElapsedSince.js";
import type { ToolUseAnswer } from "@stigmer/react-core";

/** Props for {@link ApprovalCard}. */
export interface ApprovalCardProps {
  /**
   * The tool use that waits for a person (`state === "waiting"`); its `ask`
   * says why and carries the sanitized preview the card shows.
   */
  readonly toolUse: ToolUse;
  /**
   * Called when the person answers: Approve (`"allow"`), Deny (`"deny"`, with
   * the optional reason they typed), or Approve all of the call's class
   * (`"grant"`). The consumer (typically {@link MessageThread} or a platform
   * builder's custom thread) sends it via {@link useAnswerToolUse}.
   */
  readonly onAnswer: (answer: ToolUseAnswer, denyMessage?: string) => void;
  /** True while this tool use's answer is in flight. */
  readonly isSubmitting?: boolean;
  /**
   * This gate's last failed answer, or `null` — surfaced in-card, beside the
   * actions (the optimistic spinner reverts on failure, so this explains the
   * snap-back). Supply {@link useAnswerToolUse}'s `errorsByToolUseId` entry
   * for this tool use.
   */
  readonly error?: Error | null;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a tool use that waits for a person's answer with the same visual
 * structure as an expanded {@link ToolCallItem} in the history list.
 *
 * The compact header row matches the ToolCallItem layout:
 *   [CategoryIcon] Label  primaryArg  [⏳ waiting Xm]
 *
 * The body shows the proposed change from the tool's input (the call has
 * not run, so nothing is captured yet): the write/edit content when
 * present, an {@link EmptyChangeNotice} when only a path is known,
 * otherwise the shared {@link ToolArgsView} dispatch, keeping pixel-level
 * parity with the detail view.
 *
 * Wrapped in `React.memo`: the session fold keeps an unchanged tool use's
 * reference, so the card skips re-renders during unrelated stream updates.
 *
 * @example
 * ```tsx
 * <ApprovalCard
 *   toolUse={ask}
 *   onAnswer={(answer, message) => answerToolUse(sessionId, ask.id, answer, message)}
 *   isSubmitting={submittingToolUseIds.has(ask.id)}
 * />
 * ```
 */
export const ApprovalCard = memo(function ApprovalCard({
  toolUse,
  onAnswer,
  isSubmitting = false,
  error = null,
  className,
}: ApprovalCardProps) {
  const categoryInfo = resolveToolCategoryFromCall(toolUse);

  // Cursor-grade chrome: a thin neutral card (no amber "brown" fill), with the
  // gate's "needs your decision" signal carried by one restrained cue — a 2px
  // left accent bar — plus the warning-colored clock/elapsed in the header. A
  // destructive (delete) gate keeps a red accent as a hard safety signal.
  const accentClass =
    categoryInfo.category === "delete"
      ? "stg:border-l-2 stg:border-l-destructive"
      : "stg:border-l-2 stg:border-l-warning";

  return (
    <div
      role="alert"
      aria-label={`Approval required for ${toolUse.name}`}
      className={cn(
        "stg:rounded-lg stg:border stg:border-border-prominent",
        accentClass,
        className,
      )}
    >
      <ApprovalCardHeader toolUse={toolUse} bordered />
      <ApprovalCardBody
        toolUse={toolUse}
        onAnswer={onAnswer}
        isSubmitting={isSubmitting}
        error={error}
      />
    </div>
  );
});

/** Props for {@link ApprovalCardHeader}. */
export interface ApprovalCardHeaderProps {
  /** The waiting tool use to summarize. */
  readonly toolUse: ToolUse;
  /** Adds a bottom divider, for use above {@link ApprovalCardBody}. */
  readonly bordered?: boolean;
}

/**
 * The compact summary row of an approval — `[icon] Label primaryArg [⏳ Xm]`.
 * Used as the standalone {@link ApprovalCard}'s header. Not rendered inline
 * on a {@link ToolCallItem}, whose own row already serves as the header.
 *
 * The primary argument and intent are read from the ask's sanitized preview
 * (secrets redacted), never from the raw input.
 */
export function ApprovalCardHeader({
  toolUse,
  bordered = false,
}: ApprovalCardHeaderProps) {
  const categoryInfo = resolveToolCategoryFromCall(toolUse);
  const CategoryIcon = CATEGORY_ICON[categoryInfo.category];
  const argsPreview = toolUse.ask?.argsPreview ?? "";

  const primaryArg = useMemo(
    () => extractPrimaryArgFromPreview(toolUse.name, argsPreview, toolUse.mcpServerName),
    [toolUse.name, argsPreview, toolUse.mcpServerName],
  );

  // A shell gate whose call carries a model-authored intent phrase titles
  // the header with it (stigmer#276) — supplementary context only: the
  // command stays foregrounded in the body's terminal preview, which remains
  // the content the user is approving.
  const intent = useMemo(
    () => extractShellIntentFromPreview(toolUse.name, argsPreview, toolUse.mcpServerName),
    [toolUse.name, argsPreview, toolUse.mcpServerName],
  );

  return (
    <div
      className={cn(
        "stg:flex stg:items-center stg:gap-2 stg:px-2.5 stg:py-1.5 stg:text-xs",
        bordered && "stg:border-b stg:border-border-muted",
      )}
    >
      <span className="stg:shrink-0 stg:text-warning" aria-hidden="true">
        <CategoryIcon />
      </span>

      <span className="stg:min-w-0 stg:flex-1 stg:flex stg:items-center stg:gap-1.5 stg:overflow-hidden">
        <span className="stg:shrink-0 stg:font-medium stg:text-foreground">
          {intent ?? categoryInfo.label}
        </span>
        {primaryArg &&
          categoryInfo.category !== "shell" &&
          (isFileCategory(categoryInfo.category) ? (
            // A file tool's primary arg is a path — render it filename-first
            // with the full path on hover, matching the ToolCallItem header.
            <FilePathLink
              path={primaryArg}
              className="stg:min-w-0 stg:text-xs stg:text-muted-foreground"
            />
          ) : (
            // Shell is the exception: its command is shown in the body's
            // terminal session, so the header stays minimal (icon + title).
            <span className="stg:min-w-0 stg:truncate stg:font-mono stg:text-muted-foreground">
              {primaryArg}
            </span>
          ))}
      </span>

      <WaitingDuration requestedAt={toolUse.ask?.processedAt ?? toolUse.processedAt} />

      <span className="stg:shrink-0 stg:text-warning" aria-hidden="true">
        <ClockIcon />
      </span>
    </div>
  );
}

/** Props for {@link ApprovalCardBody}. */
export interface ApprovalCardBodyProps {
  /**
   * The waiting tool use to render a decision panel for. The card shows its
   * ask's sanitized preview, with the proposed write/edit content taken from
   * the tool's input (the one value the preview cannot carry for a file of
   * any real size); nothing the runner redacted in the preview becomes
   * visible.
   */
  readonly toolUse: ToolUse;
  /** Called when the person answers: allow, deny (with an optional reason) or grant. */
  readonly onAnswer: (answer: ToolUseAnswer, denyMessage?: string) => void;
  /** True while this tool use's answer is in flight. */
  readonly isSubmitting?: boolean;
  /** This gate's last failed answer, or `null` — surfaced in-card below the actions. */
  readonly error?: Error | null;
  /** Additional CSS class names for the body container. */
  readonly className?: string;
}

/**
 * The decision panel of an approval: the optional message and gate reason, the
 * proposed change, and the actions — Approve, Deny (with an optional reason the
 * agent reads), and Approve all of the call's class for the rest of the turn.
 * Reused in two places — the standalone {@link ApprovalCard} (with
 * {@link ApprovalCardHeader} above it) and inline inside a waiting
 * {@link ToolCallItem}'s expanded panel, where the item's own row is the
 * header. One body, one preview rule in both.
 */
export function ApprovalCardBody({
  toolUse,
  onAnswer,
  isSubmitting = false,
  error = null,
  className,
}: ApprovalCardBodyProps) {
  const [activeAnswer, setActiveAnswer] = useState<ToolUseAnswer | null>(null);
  // Deny opens an inline reason row first: the reason is optional, and the
  // agent reads it as the call's result.
  const [denying, setDenying] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const reasonId = useId();

  const handleAnswer = useCallback(
    (answer: ToolUseAnswer, denyMessage?: string) => {
      setActiveAnswer(answer);
      onAnswer(answer, denyMessage);
    },
    [onAnswer],
  );

  const handleDenySubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const reason = denyReason.trim();
      handleAnswer("deny", reason === "" ? undefined : reason);
    },
    [denyReason, handleAnswer],
  );

  useEffect(() => {
    if (!isSubmitting) {
      setActiveAnswer(null);
    }
  }, [isSubmitting]);

  const ask = toolUse.ask;
  const argsPreview = ask?.argsPreview ?? "";
  const policySource = ask?.policySource ?? "";
  const policyHook = ask?.policyHook ?? "";
  const categoryInfo = resolveToolCategoryFromCall(toolUse);

  // What the card shows: the preview's fields (the runner's sanitized summary),
  // with the proposed write/edit content overlaid from the tool's input — the
  // one value the summary cannot carry for a file of any real size, and the one
  // the user is asked to approve. A preview that does not parse stays `null`:
  // nothing is overlaid onto a summary the card cannot read, and the notice
  // below says so honestly.
  const displayArgs = useMemo<Record<string, unknown> | null>(() => {
    const previewArgs = parseArgsPreview(argsPreview);
    return previewArgs ? withAuthoritativeWriteContent(previewArgs, toolUse.input) : null;
  }, [argsPreview, toolUse.input]);

  // A grant allows every call of the clicked tool's CLASS for the rest of the
  // turn — its MCP server for an MCP tool, else its approval category (where
  // write and edit collapse to one "file edits" class, mirroring the runner's
  // toolApprovalCategory). The label names that exact class so the button
  // never over-promises: it does NOT silence other classes.
  const approveAllLabel = useMemo(
    () =>
      buildApproveAllLabel(categoryInfo.category, {
        name: toolUse.name,
        mcpServerName: toolUse.mcpServerName,
        policySource,
        policyHook,
      }),
    [categoryInfo.category, toolUse.name, toolUse.mcpServerName, policySource, policyHook],
  );

  // Why-gated: the rule that asked (the ask's policy source). Smart-suppressed
  // — the everyday "this category needs approval" default is noise next to the
  // action it gates, so only a genuinely informative provenance (a hook, a
  // server-marked destructive tighten) earns a line.
  const gateReason = useMemo(
    () => describeApprovalPolicySource(policySource, policyHook),
    [policySource, policyHook],
  );
  const showGateReason = gateReason != null && isInformativePolicySource(policySource);

  // The runner's message for a file tool ("Write file: <path>") only restates
  // the header + diff, so it is suppressed; a message is shown only when it adds
  // information (e.g. an MCP tool's human-authored prompt). Shell shows its
  // command in the args view, never a message.
  const message = ask?.message ?? "";
  const showMessage =
    message !== "" &&
    categoryInfo.category !== "shell" &&
    !isFileCategory(categoryInfo.category);

  const isWriteEdit =
    categoryInfo.category === "write" || categoryInfo.category === "edit";

  // The proposed write/edit content, when the gate carries no authoritative
  // file_changes capture. Drives the three-way fallback below.
  const writeContent = useMemo(
    () => (displayArgs ? extractWriteContentFromArgs(displayArgs) : null),
    [displayArgs],
  );

  // The decision-relevant preview. The call has not run, so nothing is
  // captured yet: the gate shows the PROPOSED change from the tool's input —
  // the write/edit content when it carries one (path suppressed: the header
  // has it); a neutral "no preview" notice when only a path is known;
  // otherwise the shared args view for non-file tools. (The turn's captured
  // changes are reviewed in FileReviewCard, not here.)
  let preview: ReactNode = null;
  if (isWriteEdit && writeContent === null) {
    // No proposed content. A whole-file write is modeled as a create
    // throughout the runner (FILE_WRITE -> CREATE), so the gate says plainly
    // that a new file is being written; an edit cannot be proven a create,
    // so it keeps the non-committal notice.
    const kind = resolveToolKind(toolUse) === "file_write" ? "create" : "no-preview";
    preview = <EmptyChangeNotice kind={kind} />;
  } else if (displayArgs) {
    preview = (
      <ToolArgsView
        toolName={toolUse.name}
        args={displayArgs}
        mcpServerSlug={toolUse.mcpServerName}
        showFileName={!isWriteEdit}
      />
    );
  }

  return (
    <div className={cn("stg:px-3 stg:py-2.5 stg:space-y-2", className)}>
      {showMessage && (
        <p className="stg:text-xs stg:text-foreground">{message}</p>
      )}

      {preview}

      {/* Consent stated at grant time: approving a shell command covers
          the files it creates or changes — when the turn's mutations all come
          from approved commands, the file-change set is kept automatically and
          never re-gates. A mixed turn (commands + file-tool edits) still
          reviews everything, so this line under-promises rather than over-. */}
      {categoryInfo.category === "shell" && (
        <p className="stg:text-2xs stg:italic stg:text-muted-foreground">
          Files this command creates or changes are covered by this approval —
          they are kept automatically, with no second review.
        </p>
      )}

      {/* A background start is approved before it runs on past its call, so
          the person sees what that costs them: it lives only as long as the
          turn's invocation, which a later approval pause ends. */}
      {categoryInfo.category === "shell" && toolUse.input["background"] === true && (
        <p
          className="stg:text-2xs stg:italic stg:text-muted-foreground"
          data-cursor-target="approval-background-note"
        >
          Runs in the background while the agent works; it stops when the turn
          ends or pauses for approval.
        </p>
      )}

      {denying ? (
        // The deny row: an optional reason the agent reads, then Deny or
        // Cancel. Enter submits.
        <form
          onSubmit={handleDenySubmit}
          className="stg:flex stg:items-center stg:gap-2 stg:pt-1"
          data-cursor-target="deny-reason-form"
        >
          <label htmlFor={reasonId} className="stg:sr-only">
            Reason for denying (optional)
          </label>
          <input
            id={reasonId}
            type="text"
            autoFocus
            value={denyReason}
            onChange={(event) => setDenyReason(event.target.value)}
            placeholder="Tell the agent why (optional)"
            maxLength={2000}
            disabled={isSubmitting}
            className={cn(INPUT_CLASSES, "stg:min-w-0 stg:flex-1")}
          />
          <button
            type="submit"
            disabled={isSubmitting}
            aria-label="Deny"
            data-cursor-target="deny-confirm-button"
            className={DENY_SUBMIT_CLASSES}
          >
            Deny
          </button>
          <DecisionButton
            label="Cancel"
            variant="ghost"
            onClick={() => {
              setDenying(false);
              setDenyReason("");
            }}
            isSubmitting={isSubmitting}
          />
        </form>
      ) : (
        // Decision actions — quiet, Cursor-grade hierarchy: one neutral-chip
        // primary (Approve) and a ghost-danger Deny. The broad grant (Approve
        // all of the class) is demoted to the far right via `ml-auto` so it
        // never competes with — or is mis-clicked for — the per-call Approve.
        <div className="stg:flex stg:items-center stg:gap-2 stg:pt-1">
          <DecisionButton
            label="Approve"
            variant="primary"
            onClick={() => handleAnswer("allow")}
            isActive={activeAnswer === "allow"}
            isSubmitting={isSubmitting}
            cursorTarget="approve-button"
          />
          <DecisionButton
            label="Deny"
            variant="danger"
            onClick={() => setDenying(true)}
            isSubmitting={isSubmitting}
            cursorTarget="deny-button"
          />
          {/* Subordinate escalation: allow this call AND every call of THIS
              CLASS for the rest of the turn (its MCP server, or its file
              edit / delete / shell category) — other classes keep asking.
              The label names the class so the scope is never a surprise. */}
          <DecisionButton
            label={approveAllLabel}
            variant="ghost"
            onClick={() => handleAnswer("grant")}
            isActive={activeAnswer === "grant"}
            isSubmitting={isSubmitting}
            className="stg:ml-auto"
            cursorTarget="approve-all-button"
          />
        </div>
      )}

      {/* De-emphasized provenance, trailing the decision it explains. Only the
          informative reasons reach here (see showGateReason). */}
      {showGateReason && (
        <p
          className="stg:text-2xs stg:italic stg:text-muted-foreground"
          data-cursor-target="approval-gate-reason"
        >
          {gateReason}
        </p>
      )}

      {/* A failed decision is surfaced HERE, in-card, beside the actions — not
          via the session's global banner. A thread can hold many gates (each
          inline tool row, plus the bottom backstop), so a failure must name the
          one it belongs to; the optimistic spinner has already reverted, and
          this explains the snap-back. Shared with FileReviewCard. */}
      {error && (
        <InCardDecisionError
          error={error}
          leadIn="submit decision"
          cursorTarget="approval-error"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds the truthful "Approve all" label for a tool's grant class.
 *
 * A grant is scoped to ONE class: when a hook asked, that hook's asks on that
 * one tool (`hookApproveAllLabel`); otherwise the MCP server for an MCP tool,
 * or the approval category (write/delete/shell) — where the presentation
 * "write" and "edit" categories collapse to a single "file edits" class,
 * exactly as the runner's `toolApprovalCategory` collapses FILE_WRITE and
 * FILE_EDIT to "write". The label names that class so the button never
 * implies a broader effect than the grant actually has. The generic fallback
 * only applies to a tool with no class, which is not normally asked about.
 */
function buildApproveAllLabel(
  category: ToolCategory,
  tool: {
    readonly name: string;
    readonly mcpServerName: string;
    /** The ask's policy_source word (`hook`, `builtin_category`, ...). */
    readonly policySource: string;
    readonly policyHook: string;
  },
): string {
  const { mcpServerName } = tool;
  if (tool.policySource === "hook") {
    return hookApproveAllLabel(hookLeaseSubject(category, tool.name, mcpServerName), tool.policyHook);
  }
  if (mcpServerName) {
    return `Approve all ${mcpServerName} tools`;
  }
  switch (category) {
    case "shell":
      return "Approve all shell commands";
    case "delete":
      return "Approve all file deletions";
    case "write":
    case "edit":
      return "Approve all file edits";
    default:
      return "Approve all of this kind";
  }
}

/** What a hook grant covers, in words: one tool's calls, so a write and an edit stay apart. */
function hookLeaseSubject(category: ToolCategory, toolName: string, mcpServerName: string): string {
  if (mcpServerName) return `${toolName} calls`;
  switch (category) {
    case "shell":
      return "shell commands";
    case "delete":
      return "file deletions";
    case "write":
      return "file writes";
    case "edit":
      return "file edits";
    default:
      return `${toolName} calls`;
  }
}

/**
 * The deny row's submit button, in {@link DecisionButton}'s danger weight
 * (a form submit, so it cannot be a DecisionButton, whose type is `button`).
 */
const DENY_SUBMIT_CLASSES = cn(
  "stg:inline-flex stg:shrink-0 stg:items-center stg:justify-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5",
  "stg:text-xs stg:font-medium stg:transition-colors stg:text-destructive",
  "stg:hover:bg-destructive-subtle",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-2",
  "stg:disabled:cursor-not-allowed stg:disabled:opacity-50 stg:disabled:pointer-events-none",
);

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function WaitingDuration({ requestedAt }: { requestedAt: string }) {
  const elapsed = useElapsedSince(requestedAt);
  if (elapsed === null) return null;

  return (
    <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">
      {formatElapsed(elapsed)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function ClockIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6L7.5 7.5" />
    </svg>
  );
}
