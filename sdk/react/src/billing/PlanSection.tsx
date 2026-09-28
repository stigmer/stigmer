"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { ApiResourceKind, useResourceAvailable } from "../deployment-mode.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { ChangePlanDialog } from "./ChangePlanDialog.js";
import { PlanCard } from "./PlanCard.js";
import { PlanPicker } from "./PlanPicker.js";
import { buyablePlans, featuresLost } from "./plan-features.js";
import { planMove, planStanding, standingPlanId, type PlanMove } from "./plan-state.js";
import type { BillingRedirect } from "./redirect.js";
import { useCancelSubscription, useChangePlan } from "./useChangePlan.js";
import { useCreatePaymentMethodSetupSession } from "./useCreatePaymentMethodSetupSession.js";
import { usePeriodEstimate } from "./usePeriodEstimate.js";
import { usePlans } from "./usePlans.js";
import { useSubscription } from "./useSubscription.js";

/** How often, and how long, the section waits for a just-saved card to reach the account. */
const CARD_POLL_MS = 2_000;
const CARD_WAIT_MS = 30_000;

/** Props for {@link PlanSection}. */
export interface PlanSectionProps {
  /** The organization whose plan is shown. */
  readonly orgId: string;
  /**
   * The organization is platform-managed: it runs on its integrator's
   * plan, and the section says so instead of offering plans.
   */
  readonly managed?: boolean;
  /** Whether the organization's billing account holds a saved card. */
  readonly hasPaymentMethod: boolean;
  /** Re-read the billing account, so a card saved on Stripe's page shows. */
  readonly onRefreshAccount?: () => void;
  /** The host's seam for Stripe-hosted pages (see {@link BillingRedirect}). */
  readonly redirect?: BillingRedirect;
  /**
   * The plan the person was choosing when they left to save a card (the
   * `plan` query Stripe returns with). The section reopens that choice for
   * an explicit confirm; it never subscribes on its own.
   */
  readonly resumePlanId?: string;
  /** Called once the resumed choice has been taken up, so the host can clear its query. */
  readonly onResumeHandled?: () => void;
  /** The clock the standing reads. Defaults to each render's time. */
  readonly now?: Date;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * An organization's plan on Stigmer Cloud: the current plan with its
 * standing and the period's estimated invoice, the plan comparison, and
 * the confirm step for a subscribe, switch, resume or cancel.
 *
 * Everyone who can view the organization's billing reads it; only those
 * who can manage billing (its admins) see the choices. Renders nothing on
 * an edition that serves no subscriptions.
 *
 * @example
 * ```tsx
 * <PlanSection orgId={orgId} hasPaymentMethod={hasCard} />
 * ```
 */
export function PlanSection({
  orgId,
  managed = false,
  hasPaymentMethod,
  onRefreshAccount,
  redirect,
  resumePlanId,
  onResumeHandled,
  now,
  className,
}: PlanSectionProps) {
  const available = useResourceAvailable(ApiResourceKind.subscription);
  const renderNow = now ?? new Date();
  const catalog = usePlans({ includeRetired: true, enabled: available });
  const current = useSubscription(available ? orgId : null);
  const standing = planStanding(current.subscription, renderNow);
  const livePlanId = standingPlanId(standing);
  const estimate = usePeriodEstimate(orgId, { enabled: available && !managed && livePlanId !== "" });
  const manage = useCheckPermission(available && orgId ? { kind: "organization", id: orgId } : null, "can_manage_billing");
  const canManage = !managed && !manage.isLoading && manage.allowed;

  const changer = useChangePlan();
  const canceler = useCancelSubscription();
  const setup = useCreatePaymentMethodSetupSession(redirect);
  const [move, setMove] = useState<PlanMove | null>(null);
  const [awaitingCard, setAwaitingCard] = useState(false);

  const buyable = useMemo(() => buyablePlans(catalog.plans ?? []), [catalog.plans]);
  const planById = useCallback(
    (planId: string) => catalog.plans?.find((plan) => plan.metadata?.id === planId),
    [catalog.plans],
  );
  const planName = useCallback((planId: string) => planById(planId)?.metadata?.name ?? "your plan", [planById]);
  const periodEndStamp = current.subscription?.status?.currentPeriodEnd;
  const periodEnd = periodEndStamp === undefined ? undefined : timestampDate(periodEndStamp);

  // Back from Stripe's card page: reopen the choice the person was making.
  // Keyed by the plan resumed, and cleared once the host drops the query,
  // because a desktop host stays mounted across returns and may resume again.
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (resumePlanId === undefined || resumePlanId === "") {
      resumedFor.current = null;
      return;
    }
    if (resumedFor.current === resumePlanId || catalog.plans === null || current.isLoading) {
      return;
    }
    resumedFor.current = resumePlanId;
    const target = buyable.find((plan) => plan.metadata?.id === resumePlanId);
    const resumedMove = target === undefined ? null : planMove(standing, target, periodEnd);
    if (resumedMove !== null) {
      setMove(resumedMove);
      setAwaitingCard(!hasPaymentMethod);
    }
    onResumeHandled?.();
  }, [resumePlanId, catalog.plans, current.isLoading, buyable, standing, periodEnd, hasPaymentMethod, onResumeHandled]);

  // The card lands on the account by webhook a few seconds after Stripe's
  // page returns; poll the account until it does, bounded.
  useEffect(() => {
    if (!awaitingCard) return;
    if (hasPaymentMethod) {
      setAwaitingCard(false);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > CARD_WAIT_MS) {
        setAwaitingCard(false);
        clearInterval(timer);
        return;
      }
      onRefreshAccount?.();
    }, CARD_POLL_MS);
    return () => clearInterval(timer);
  }, [awaitingCard, hasPaymentMethod, onRefreshAccount]);

  const close = useCallback(() => {
    setMove(null);
    setAwaitingCard(false);
    changer.clearError();
    canceler.clearError();
    setup.clearError();
  }, [changer.clearError, canceler.clearError, setup.clearError]);

  const refreshAll = useCallback(() => {
    current.refetch();
    estimate.refetch();
  }, [current.refetch, estimate.refetch]);

  const confirm = useCallback(() => {
    if (move === null) return;
    const done = move.kind === "cancel" ? canceler.cancel(orgId) : changer.changePlan(orgId, move.to.metadata?.id ?? "");
    done.then(
      () => {
        setMove(null);
        refreshAll();
      },
      () => undefined,
    );
  }, [move, orgId, canceler.cancel, changer.changePlan, refreshAll]);

  const addPaymentMethod = useCallback(() => {
    const planId = move !== null && move.kind !== "cancel" ? move.to.metadata?.id : undefined;
    setup.addPaymentMethod(orgId, planId).catch(() => undefined);
  }, [move, orgId, setup.addPaymentMethod]);

  if (!available) {
    return null;
  }

  if (current.isLoading || catalog.isLoading) {
    return (
      <div className={cn("stg:space-y-3", className)} aria-busy="true" aria-label="Loading plan">
        <div className="stg:h-24 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
      </div>
    );
  }

  const readError = current.error ?? catalog.error;
  if (readError) {
    return (
      <p className={cn("stg:text-xs stg:text-destructive", className)} role="alert">
        {getUserMessage(readError)}
      </p>
    );
  }

  const nameInForce = livePlanId === "" ? "Free" : planName(livePlanId);
  const moveError = move?.kind === "cancel" ? canceler.error : (changer.error ?? setup.error);
  const losing = move?.kind === "switch" ? featuresLost(planById(move.fromPlanId), move.to) : [];

  return (
    <section className={cn("stg:space-y-3", className)} aria-label="Plan">
      <PlanCard
        planName={nameInForce}
        standing={standing}
        estimate={estimate.estimate}
        estimateError={estimate.error}
        managed={managed}
      />
      {!managed && (
        <PlanPicker
          plans={buyable}
          standing={standing}
          periodEnd={periodEnd}
          canManage={canManage}
          onChoose={setMove}
          disabled={changer.isSubmitting || canceler.isSubmitting}
        />
      )}
      <ChangePlanDialog
        move={move}
        planName={planName}
        losing={losing}
        hasPaymentMethod={hasPaymentMethod}
        awaitingPaymentMethod={awaitingCard}
        isSubmitting={changer.isSubmitting || canceler.isSubmitting || setup.isSubmitting}
        error={moveError}
        onConfirm={confirm}
        onAddPaymentMethod={addPaymentMethod}
        onClose={close}
      />
    </section>
  );
}
