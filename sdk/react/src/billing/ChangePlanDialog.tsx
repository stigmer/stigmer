"use client";

import { useId } from "react";
import { getErrorReason, getUserMessage } from "@stigmer/sdk";
import type { PlanTerms } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { Button } from "../button/index.js";
import { DialogShell } from "../internal/DialogShell.js";
import { formatDay, formatMonthlyMinimum, sharePercent, type OfferedFeature } from "./plan-features.js";
import type { PlanMove } from "./plan-state.js";

/** The reason a plan change is refused for want of a saved card (billing/subscription/v1/command.proto). */
export const PAYMENT_METHOD_REQUIRED = "PAYMENT_METHOD_REQUIRED";

/** Props for {@link ChangePlanDialog}. */
export interface ChangePlanDialogProps {
  /** The move to confirm; the dialog is open while it is set. */
  readonly move: PlanMove | null;
  /** The display name of a plan by id, for the plan being left. */
  readonly planName: (planId: string) => string;
  /**
   * For a switch, what the plan being left offers that the new one does
   * not (`featuresLost`). Empty, as for an upgrade, the dialog says
   * nothing is lost.
   */
  readonly losing?: readonly OfferedFeature[];
  /**
   * Whether the organization has a saved card. Every move but a cancel
   * needs one, because every period is collected from it.
   */
  readonly hasPaymentMethod: boolean;
  /**
   * The card was just saved on Stripe's page and is on its way to the
   * account: say so instead of asking for one again.
   */
  readonly awaitingPaymentMethod?: boolean;
  /** `true` while the move, or the card page, is in flight. */
  readonly isSubmitting: boolean;
  /** Why the last attempt failed, or `null`. */
  readonly error: Error | null;
  /** Make the move. */
  readonly onConfirm: () => void;
  /** Leave to save a card, returning to this choice. */
  readonly onAddPaymentMethod: () => void;
  /** Close without moving. */
  readonly onClose: () => void;
}

/**
 * The confirm step for a plan change. It states exactly what the move does
 * and when money moves: a subscription starts now and every period is
 * collected when it closes; a switch closes this period early, billed for
 * the time it ran; a cancel keeps the plan to its period's end and deletes
 * nothing. Without a saved card it offers the card page first.
 */
export function ChangePlanDialog({
  move,
  planName,
  losing = [],
  hasPaymentMethod,
  awaitingPaymentMethod,
  isSubmitting,
  error,
  onConfirm,
  onAddPaymentMethod,
  onClose,
}: ChangePlanDialogProps) {
  const headingId = useId();
  const needsCard =
    move !== null &&
    move.kind !== "cancel" &&
    (!hasPaymentMethod || getErrorReason(error)?.reason === PAYMENT_METHOD_REQUIRED);

  return (
    <DialogShell
      open={move !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width="md"
      aria-labelledby={headingId}
    >
      {move && (
        <div className="stg:space-y-3 stg:p-5">
          <h2 id={headingId} className="stg:text-sm stg:font-semibold stg:text-foreground">
            {title(move)}
          </h2>
          <div className="stg:space-y-2 stg:text-xs stg:text-muted-foreground">{body(move, planName, losing)}</div>

          {needsCard && (
            <p className="stg:rounded-md stg:bg-muted-subtle stg:px-3 stg:py-2 stg:text-xs stg:text-foreground" role="status">
              {awaitingPaymentMethod
                ? "Your card is being saved. This takes a few seconds; the choice is kept."
                : "A saved card is needed first: every period is collected from it. You come back here after saving it."}
            </p>
          )}
          {error && getErrorReason(error)?.reason !== PAYMENT_METHOD_REQUIRED && (
            <p className="stg:text-xs stg:text-destructive" role="alert">
              {getUserMessage(error)}
            </p>
          )}

          <div className="stg:flex stg:justify-end stg:gap-2 stg:pt-1">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
              Not now
            </Button>
            {needsCard ? (
              <Button size="sm" onClick={onAddPaymentMethod} disabled={isSubmitting || awaitingPaymentMethod}>
                Add a payment method
              </Button>
            ) : (
              <Button
                variant={move.kind === "cancel" ? "destructive" : "primary"}
                size="sm"
                onClick={onConfirm}
                disabled={isSubmitting}
              >
                {confirmLabel(move)}
              </Button>
            )}
          </div>
        </div>
      )}
    </DialogShell>
  );
}

function title(move: PlanMove): string {
  switch (move.kind) {
    case "subscribe":
      return `Subscribe to ${move.to.metadata?.name ?? "this plan"}`;
    case "switch":
      return `Switch to ${move.to.metadata?.name ?? "this plan"}`;
    case "resume":
      return `Keep ${move.to.metadata?.name ?? "this plan"}`;
    case "cancel":
      return "Move to Free";
    default: {
      const exhaustive: never = move;
      return String(exhaustive);
    }
  }
}

function body(move: PlanMove, planName: (planId: string) => string, losing: readonly OfferedFeature[]) {
  switch (move.kind) {
    case "subscribe":
      return (
        <>
          <p>
            {move.to.metadata?.name} starts now. Each monthly period is billed when it ends:{" "}
            {periodCharge(move.to.spec?.terms)}
          </p>
          <p>Nothing is charged today.</p>
        </>
      );
    case "switch":
      return (
        <>
          <p>
            The switch takes effect now. This period closes early and is billed for the time it ran on{" "}
            {planName(move.fromPlanId)}; a new monthly period opens on {move.to.metadata?.name} at{" "}
            {formatMonthlyMinimum(move.to.spec?.terms)}.
          </p>
          {losing.length > 0 && (
            <p>
              {move.to.metadata?.name} does not include {listFeatures(losing)}. {keepsWorking(losing)}
            </p>
          )}
        </>
      );
    case "resume":
      return <p>The cancellation is withdrawn, and {move.to.metadata?.name} runs on into its next period.</p>;
    case "cancel":
      return (
        <>
          <p>
            {planName(move.fromPlanId)} stays in force until {formatDay(move.endsAt)}, then this organization is on
            Free. The period is billed as usual when it closes.
          </p>
          <p>Nothing you built is deleted. Creating what Free does not include is refused until you subscribe again.</p>
        </>
      );
    default: {
      const exhaustive: never = move;
      return String(exhaustive);
    }
  }
}

function confirmLabel(move: PlanMove): string {
  switch (move.kind) {
    case "subscribe":
      return "Subscribe";
    case "switch":
      return "Switch now";
    case "resume":
      return "Keep plan";
    case "cancel":
      return "Cancel plan";
    default: {
      const exhaustive: never = move;
      return String(exhaustive);
    }
  }
}

/** "Teams", "Teams and Managed organizations", "A, B and C". */
/**
 * What still works after a switch that gives features up. Everything built
 * keeps working, except an organization's own provider keys: they are kept
 * but no longer used, so its agents run on Stigmer's keys, billed as usage.
 */
function keepsWorking(losing: readonly OfferedFeature[]): string {
  return losing.some((lost) => lost.feature === Feature.byo_provider_keys)
    ? "Your own provider keys are kept but stop being used: your agents run on Stigmer's keys, billed as usage. " +
        "Everything else you built keeps working; only creating more is refused."
    : "Everything you built keeps working; only creating more is refused.";
}

function listFeatures(features: readonly OfferedFeature[]): string {
  const labels = features.map((feature) => feature.label);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** What a period of the plan is billed at its end, in the customer's words. */
function periodCharge(terms: PlanTerms | undefined): string {
  const minimum = formatMonthlyMinimum(terms);
  const percent = sharePercent(terms);
  return percent === ""
    ? `${minimum}.`
    : `${minimum}, less the ${percent} commission already paid on that period's usage. Usage itself stays paid from credits.`;
}
