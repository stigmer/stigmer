"use client";

// The platform operator's plan catalogue, inside the shared settings frame:
// every plan with its terms, retiring one, and creating one. The frame says
// when this edition sells no plans and when the person is not a platform
// operator.

import { useCallback, useState, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage, isUnimplemented } from "@stigmer/client";
import type { Plan } from "@stigmer/apis/ai/stigmer/billing/plan/v1/api_pb";
import { PlanInstrument } from "@stigmer/apis/ai/stigmer/billing/plan/v1/spec_pb";
import { PlanLifecycle } from "@stigmer/apis/ai/stigmer/billing/plan/v1/status_pb";
import { formatChildOrgs, formatMonthlyFee, offeredFeatures } from "../billing/plan-features.js";
import { usePlans } from "../billing/usePlans.js";
import { Button } from "../button/index.js";
import { useResourceAvailable } from "@stigmer/react-core";
import { ApiResourceKind } from "@stigmer/react-core/internal";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { SettingsPage } from "../settings/SettingsPage.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { Card, cardClasses } from "../internal/surface/Card.js";
import { FEATURE_COPY, isNamedFeature } from "../internal/features.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { StatusBadge } from "../status/StatusBadge.js";
import { PlanCreateForm } from "./PlanCreateForm.js";
import { PLANS_DENIAL } from "./PlansAccessNotice.js";
import { useRetirePlan } from "./usePlanMutations.js";

/** The platform object the catalog's permission is held on. */
const PLATFORM = { kind: "platform", id: "stigmer" } as const;

/** Props for {@link PlanCatalogConsole}. */
export interface PlanCatalogConsoleProps {
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * The platform-operator console for the Stigmer Cloud plan catalog: every
 * plan, retired ones included, with its terms and what it offers; retiring
 * a plan; and creating one.
 *
 * Every signed-in caller may read the catalog, so the page gates on
 * `can_manage_plans` on `platform:stigmer` itself, and anyone without it
 * sees the designed access notice. Organizations choose their plan under
 * Billing, not here.
 *
 * @example
 * ```tsx
 * <PlanCatalogConsole />
 * ```
 */
export function PlanCatalogConsole({ className }: PlanCatalogConsoleProps) {
  const available = useResourceAvailable(ApiResourceKind.plan);
  const operator = useCheckPermission(available ? PLATFORM : null, "can_manage_plans", { fail: "closed" });
  const catalog = usePlans({ includeRetired: true, enabled: available && operator.allowed });
  const retirer = useRetirePlan();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const [creating, setCreating] = useState(false);
  const startCreate = useCallback(() => setCreating(true), []);

  const unavailable = !available || (catalog.error !== null && isUnimplemented(catalog.error));
  const checking = operator.isLoading || (operator.allowed && catalog.plans === null && catalog.error === null);
  const denied = !unavailable && !operator.isLoading && !operator.allowed;
  const frame = (body: ReactNode) => (
    <SettingsPage
      title="Plans"
      description="The plans organizations subscribe to. A plan's terms are final; change them with a new plan and retire the old one."
      actions={
        operator.allowed &&
        !creating && (
          <Button size="sm" onClick={startCreate}>
            New plan
          </Button>
        )
      }
      unavailable={
        unavailable &&
        "Plans come with Stigmer Cloud, which sells them. On this edition nothing is sold, so there is no plan catalogue."
      }
      denied={denied ? PLANS_DENIAL : false}
      className={className}
    >
      {body}
    </SettingsPage>
  );

  if (unavailable || denied) {
    return frame(null);
  }
  if (checking) {
    return frame(<SettingsSkeleton label="Loading plans" rows={3} />);
  }
  if (catalog.error) {
    return frame(<ErrorMessage error={catalog.error} title="Couldn't load the plans." retry={catalog.refetch} />);
  }

  const retire = async (plan: Plan) => {
    const ok = await confirm({
      title: `Retire ${plan.metadata?.name ?? "this plan"}?`,
      description:
        "It can no longer be bought. Every organization already on it keeps it, invoiced by its terms. Retiring is final.",
      confirmLabel: "Retire",
      variant: "destructive",
    });
    if (ok) {
      retirer.retirePlan(plan.metadata?.id ?? "").then(catalog.refetch, () => undefined);
    }
  };

  const plans = catalog.plans ?? [];
  return frame(
    <div className="stg:space-y-4">
      {creating ? (
        <Card>
          <PlanCreateForm
            onCreated={() => {
              setCreating(false);
              catalog.refetch();
            }}
            onCancel={() => setCreating(false)}
          />
        </Card>
      ) : null}
      {retirer.error && (
        <p className="stg:text-xs stg:text-destructive" role="alert">
          {getUserMessage(retirer.error)}
        </p>
      )}
      {plans.length === 0 ? (
        <EmptyState
          variant="first-use"
          title="No plans yet"
          description="Create the first plan organizations can subscribe to."
          action={creating ? undefined : { label: "New plan", onClick: startCreate }}
        />
      ) : (
        <ul className={cn(UNSTYLED_LIST, cardClasses({ flush: true }), "stg:divide-y stg:divide-border-muted")} aria-label="Plan catalog">
          {plans.map((plan) => (
            <PlanRow key={plan.metadata?.id} plan={plan} onRetire={() => void retire(plan)} busy={retirer.isSubmitting} />
          ))}
        </ul>
      )}
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </div>,
  );
}

function PlanRow({ plan, onRetire, busy }: { readonly plan: Plan; readonly onRetire: () => void; readonly busy: boolean }) {
  const active = plan.status?.lifecycle === PlanLifecycle.active;
  const license = plan.spec?.instrument === PlanInstrument.license;
  const terms = plan.spec?.terms;
  const listed = (plan.spec?.entitlements?.features ?? []).filter(isNamedFeature).map((f) => FEATURE_COPY[f].label);
  const offered = new Set(offeredFeatures(plan.spec?.entitlements).map((f) => f.label));
  const managed = formatChildOrgs(plan.spec?.entitlements, terms);
  return (
    <li className="stg:px-3.5 stg:py-2.5">
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          <p className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
            {plan.metadata?.name}{" "}
            <span className="stg:font-normal stg:text-muted-foreground">({plan.metadata?.slug})</span>
          </p>
          <p className="stg:text-xs stg:text-muted-foreground">
            {license
              ? "Issued as a license"
              : formatMonthlyFee(terms)}
          </p>
        </div>
        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-2">
          <StatusBadge phase={active ? "ready" : "disabled"} label={active ? "On sale" : "Retired"} />
          {active && (
            <Button variant="outline" size="xs" onClick={onRetire} disabled={busy}>
              Retire
            </Button>
          )}
        </div>
      </div>
      <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
        {listed.map((label) => (offered.has(label) ? label : `${label} (not offered yet)`)).join(" · ")}
        {managed === "" ? "" : ` · ${managed}`}
      </p>
    </li>
  );
}
