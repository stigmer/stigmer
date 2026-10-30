"use client";

import { useId } from "react";
import { getUserMessage } from "@stigmer/client";
import { useDeploymentMode } from "@stigmer/react-core";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { useOrg } from "../organization/OrgProvider.js";
import { useBillingAccount } from "./useBillingAccount.js";
import { useCreateBillingPortalSession } from "./useCreateBillingPortalSession.js";
import { PaymentMethodCard } from "./PaymentMethodCard.js";
import { PlanSection } from "./PlanSection.js";
import type { BillingRedirect } from "./redirect.js";
import { useCreatePaymentMethodSetupSession } from "./useCreatePaymentMethodSetupSession.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

/** Props for {@link BillingSection}. */
export interface BillingSectionProps {
  /**
   * The plan the person was choosing when they left to save a card: the
   * `plan` query Stripe returns with after `?setup=success`. The plan
   * section reopens that choice for an explicit confirm.
   */
  readonly resumePlanId?: string;
  /** Called once the resumed plan choice is taken up, so the host can clear its query. */
  readonly onResumeHandled?: () => void;
  /**
   * The host's seam for Stripe-hosted pages (card setup and the billing
   * portal). Absent, this window navigates to them and Stripe
   * returns to this origin's `/settings/billing`. A desktop host opens the
   * system browser and names the web console's billing page instead; its
   * reads refresh when the window regains focus.
   */
  readonly redirect?: BillingRedirect;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Top-level billing settings section.
 *
 * Composes the plan (its price, standing and the period's estimated
 * invoice) and the card on file, which opens Stripe's billing portal for
 * invoices. Handles the deployment mode gate (billing unavailable in local
 * mode) and the org-not-selected state.
 *
 * @example
 * ```tsx
 * // In a settings page, resuming the plan a saved card was for:
 * <BillingSection resumePlanId={searchParams.plan} />
 * ```
 */
export function BillingSection({
  resumePlanId,
  onResumeHandled,
  redirect,
  className,
}: BillingSectionProps) {
  const headingId = useId();
  const { activeOrg, orgs } = useOrg();
  const mode = useDeploymentMode();
  const orgId = activeOrg?.metadata?.id ?? "";
  // A child organization runs on its parent's plan. The parent is named
  // when the person belongs to it too; otherwise the card says "its parent
  // organization" rather than show a raw id.
  const parentOrg = activeOrg?.spec?.parentOrg ?? "";
  const billedToParent =
    parentOrg === ""
      ? undefined
      : ((orgs ?? []).find((o) => o.metadata?.id === parentOrg)?.metadata?.name ?? "");

  return (
    <section aria-labelledby={headingId} className={className}>
      <h2
        id={headingId}
        className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold"
      >
        Billing
      </h2>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Your plan, payment method and invoices.
      </p>

      {mode === "local" ? (
        <CloudFeatureNotice>
          Plans and invoices are available on Stigmer Cloud. Local mode uses
          your own LLM API keys directly.
        </CloudFeatureNotice>
      ) : !orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view billing.
        </p>
      ) : (
        <BillingContent
          org={orgId}
          billedToParent={billedToParent}
          resumePlanId={resumePlanId}
          onResumeHandled={onResumeHandled}
          redirect={redirect}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// BillingContent (internal)
// ---------------------------------------------------------------------------

function BillingContent({
  org: orgId,
  billedToParent,
  resumePlanId,
  onResumeHandled,
  redirect,
}: {
  org: string;
  billedToParent: string | undefined;
  resumePlanId?: string;
  onResumeHandled?: () => void;
  redirect?: BillingRedirect;
}) {
  const { account, isLoading, error, refetch } = useBillingAccount(orgId, {
    refetchOnWindowFocus: redirect?.openUrl !== undefined,
  });
  const { openPortal, isLoading: isPortalLoading } = useCreateBillingPortalSession(redirect);
  const setup = useCreatePaymentMethodSetupSession(redirect);

  if (isLoading) {
    return (
      <LoadingRegion className="stg:space-y-4" label="Loading billing">
        <div className="stg:h-36 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
        <div className="stg:h-24 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
      </LoadingRegion>
    );
  }

  if (error) {
    return (
      <p className="stg:text-destructive stg:text-xs" role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (!account) return null;

  const hasPaymentMethod =
    account.defaultPaymentMethod != null && account.defaultPaymentMethod.paymentMethodId !== "";

  return (
    <div className="stg:space-y-6">
      <PlanSection
        org={orgId}
        billedToParent={billedToParent}
        hasPaymentMethod={hasPaymentMethod}
        onRefreshAccount={refetch}
        redirect={redirect}
        resumePlanId={resumePlanId}
        onResumeHandled={onResumeHandled}
      />

      <PaymentMethodCard
        paymentMethod={account.defaultPaymentMethod}
        accountStatus={account.status}
        isPortalLoading={isPortalLoading}
        onManage={() => openPortal(orgId)}
        onAdd={() => {
          setup.addPaymentMethod(orgId).catch(() => undefined);
        }}
        isAdding={setup.isSubmitting}
      />
      {setup.error && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(setup.error)}
        </p>
      )}
    </div>
  );
}
