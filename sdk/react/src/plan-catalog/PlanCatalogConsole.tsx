"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, isUnimplemented } from "@stigmer/sdk";
import type { Plan } from "@stigmer/protos/ai/stigmer/billing/plan/v1/api_pb";
import { PlanInstrument } from "@stigmer/protos/ai/stigmer/billing/plan/v1/spec_pb";
import { PlanLifecycle } from "@stigmer/protos/ai/stigmer/billing/plan/v1/status_pb";
import { formatCreditBalance } from "../billing/format.js";
import { formatManagedOrganizations, formatUsageShare, offeredFeatures } from "../billing/plan-features.js";
import { usePlans } from "../billing/usePlans.js";
import { Button } from "../button/index.js";
import { ApiResourceKind, useResourceAvailable } from "../deployment-mode.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { FEATURE_COPY, isNamedFeature } from "../internal/features.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { StatusBadge } from "../resource-workbench/components/StatusBadge.js";
import { PlanCreateForm } from "./PlanCreateForm.js";
import { PlansAccessNotice } from "./PlansAccessNotice.js";
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

  const header = <ConsoleHeader onCreate={operator.allowed && !creating ? () => setCreating(true) : undefined} />;

  if (!available || (catalog.error && isUnimplemented(catalog.error))) {
    return (
      <div className={cn("stg:space-y-3", className)}>
        {header}
        <CloudFeatureNotice>
          Plans are sold on Stigmer Cloud. The server this console is connected to serves no plan catalog.
        </CloudFeatureNotice>
      </div>
    );
  }
  if (operator.isLoading || (operator.allowed && catalog.plans === null && catalog.error === null)) {
    return (
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="stg:h-12 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
        ))}
      </div>
    );
  }
  if (!operator.allowed) {
    return (
      <div className={cn("stg:space-y-3", className)}>
        {header}
        <PlansAccessNotice />
      </div>
    );
  }
  if (catalog.error) {
    return (
      <div className={cn("stg:space-y-3", className)}>
        {header}
        <p className="stg:text-sm stg:text-destructive" role="alert">
          {getUserMessage(catalog.error)}
        </p>
        <Button variant="outline" onClick={catalog.refetch}>
          Try again
        </Button>
      </div>
    );
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

  return (
    <div className={cn("stg:space-y-4", className)}>
      {header}
      {creating ? (
        <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4">
          <PlanCreateForm
            onCreated={() => {
              setCreating(false);
              catalog.refetch();
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}
      {retirer.error && (
        <p className="stg:text-xs stg:text-destructive" role="alert">
          {getUserMessage(retirer.error)}
        </p>
      )}
      <ul className={cn(UNSTYLED_LIST, "stg:space-y-2")} aria-label="Plan catalog">
        {(catalog.plans ?? []).map((plan) => (
          <PlanRow key={plan.metadata?.id} plan={plan} onRetire={() => void retire(plan)} busy={retirer.isSubmitting} />
        ))}
      </ul>
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </div>
  );
}

function ConsoleHeader({ onCreate }: { readonly onCreate?: () => void }) {
  return (
    <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
      <div>
        <h2 className="stg:text-sm stg:font-semibold stg:text-foreground">Plans</h2>
        <p className="stg:text-xs stg:text-muted-foreground">
          The plans organizations subscribe to. A plan&apos;s terms are final; change them with a new plan and retire the
          old one.
        </p>
      </div>
      {onCreate && (
        <Button size="xs" onClick={onCreate}>
          New plan
        </Button>
      )}
    </div>
  );
}

function PlanRow({ plan, onRetire, busy }: { readonly plan: Plan; readonly onRetire: () => void; readonly busy: boolean }) {
  const active = plan.status?.lifecycle === PlanLifecycle.active;
  const license = plan.spec?.instrument === PlanInstrument.license;
  const terms = plan.spec?.terms;
  const listed = (plan.spec?.entitlements?.features ?? []).filter(isNamedFeature).map((f) => FEATURE_COPY[f].label);
  const offered = new Set(offeredFeatures(plan.spec?.entitlements).map((f) => f.label));
  const managed = formatManagedOrganizations(plan.spec?.entitlements, terms);
  return (
    <li className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-3">
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          <p className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
            {plan.metadata?.name}{" "}
            <span className="stg:font-normal stg:text-muted-foreground">({plan.metadata?.slug})</span>
          </p>
          <p className="stg:text-xs stg:text-muted-foreground">
            {license
              ? "Issued as a license"
              : `${formatCreditBalance(terms?.monthlyMinimumMicros ?? BigInt(0))}/month ${formatUsageShare(terms)}`}
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
