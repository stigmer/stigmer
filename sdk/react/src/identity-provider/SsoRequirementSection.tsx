"use client";

/**
 * Whether an organization requires its members to sign in through its SSO
 * provider (`IdentityProviderSpec.sso_required`), shown on the SSO
 * provider's page and changed by the organization's owners only: requiring
 * a sign-in decides how every member gets in.
 *
 * Turning it on first shows who would stop counting (the owners' preview:
 * the members the provider has not signed in yet, the automations that act
 * as them, the owners, who are exempt), so nobody is surprised. Turning it
 * off asks only for a confirmation; an organization may always turn it off.
 *
 * On Stigmer Cloud it is a plan feature: where the organization's plan
 * lacks it, the switch is replaced by the plan notice while it is off, and
 * an organization that already requires it keeps it and may turn it off.
 * Only Cloud reads the plan; on Enterprise it is an edition feature.
 */
import { useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, toIdentityProviderUpdateInput } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { UpgradeNotice, planUpgradeFeature } from "../billing/UpgradeNotice.js";
import { useEntitlements } from "../billing/useEntitlements.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { usePreviewSsoRequirement } from "./usePreviewSsoRequirement.js";
import { useUpdateIdentityProvider } from "./useUpdateIdentityProvider.js";

/** Props for {@link SsoRequirementSection}. */
export interface SsoRequirementSectionProps {
  /** The organization's SSO provider. */
  readonly identityProvider: IdentityProvider;
  /** Fired with the provider after the requirement changed. */
  readonly onUpdated?: (provider: IdentityProvider) => void;
  readonly className?: string;
}

type Step = "idle" | "confirm-on" | "confirm-off";

export function SsoRequirementSection({ identityProvider, onUpdated, className }: SsoRequirementSectionProps) {
  const spec = identityProvider.spec;
  const org = identityProvider.metadata?.org ?? "";
  const required = spec?.ssoRequired ?? false;
  const providerName = spec?.displayName || identityProvider.metadata?.name || "this provider";
  const onCloud = useDeploymentMode() === "cloud";
  const plan = useEntitlements(org || null, { enabled: onCloud });
  const planLacksIt = plan.allows(Feature.sso_enforcement) === false;
  const [step, setStep] = useState<Step>("idle");
  const { update, isUpdating, error, clearError } = useUpdateIdentityProvider();

  if (spec?.isSsoProvider !== true) {
    return null;
  }

  const change = async (next: boolean) => {
    clearError();
    try {
      const updated = await update({ ...toIdentityProviderUpdateInput(identityProvider), ssoRequired: next });
      setStep("idle");
      onUpdated?.(updated);
    } catch {
      // The hook holds the error, shown below.
    }
  };

  const planFeature = error ? planUpgradeFeature(error) : null;

  return (
    <section className={cn("stg:space-y-2 stg:rounded-lg stg:border stg:border-border stg:p-3", className)}>
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div>
          <h4 className="stg:text-foreground stg:text-xs stg:font-semibold">Require this sign-in</h4>
          <p className="stg:text-muted-foreground stg:mt-0.5 stg:text-xs">
            {required
              ? `Members act in this organization only through ${providerName}. Owners keep their own sign-in as a way back in.`
              : `Members may sign in through ${providerName} or another way.`}
          </p>
        </div>
        {step === "idle" && (
          <PermissionGate resource={{ kind: "organization", id: org }} relation="can_assign_roles">
            {required ? (
              <button
                type="button"
                onClick={() => setStep("confirm-off")}
                className="stg:text-primary stg:shrink-0 stg:text-xs stg:font-medium stg:hover:text-foreground"
              >
                Stop requiring it
              </button>
            ) : planLacksIt ? null : (
              <button
                type="button"
                onClick={() => setStep("confirm-on")}
                className="stg:text-primary stg:shrink-0 stg:text-xs stg:font-medium stg:hover:text-foreground"
              >
                Require it…
              </button>
            )}
          </PermissionGate>
        )}
      </div>

      {!required && planLacksIt && <UpgradeNotice feature={Feature.sso_enforcement} />}

      {step === "confirm-on" && (
        <RequirementPreview
          org={org}
          providerName={providerName}
          isUpdating={isUpdating}
          onConfirm={() => void change(true)}
          onCancel={() => setStep("idle")}
        />
      )}

      {step === "confirm-off" && (
        <div className="stg:space-y-2 stg:text-xs">
          <p className="stg:text-foreground">
            Members will be able to sign in another way again, and their other accounts will count here again.
          </p>
          <ConfirmButtons label="Stop requiring it" isUpdating={isUpdating} onConfirm={() => void change(false)} onCancel={() => setStep("idle")} />
        </div>
      )}

      {error &&
        (planFeature !== null ? (
          <UpgradeNotice feature={planFeature} error={error} />
        ) : (
          <p role="alert" className="stg:text-destructive stg:text-xs">
            {getUserMessage(error)}
          </p>
        ))}
    </section>
  );
}

function RequirementPreview({
  org,
  providerName,
  isUpdating,
  onConfirm,
  onCancel,
}: {
  org: string;
  providerName: string;
  isUpdating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { preview, isLoading, error } = usePreviewSsoRequirement(org);
  if (isLoading) {
    return <p className="stg:text-muted-foreground stg:text-xs">Finding who would be affected…</p>;
  }
  if (error) {
    return (
      <p role="alert" className="stg:text-destructive stg:text-xs">
        {getUserMessage(error)}
      </p>
    );
  }
  const members = preview?.members ?? [];
  const owners = preview?.exemptOwners ?? [];
  return (
    <div className="stg:space-y-2 stg:text-xs">
      {members.length === 0 ? (
        <p className="stg:text-foreground">Every member has signed in through {providerName}. Nobody stops counting.</p>
      ) : (
        <>
          <p className="stg:text-foreground">
            {members.length === 1 ? "One member has" : `${members.length} members have`} not signed in through{" "}
            {providerName} yet and will be refused here until they do. Each can bring their access with them once they
            sign in through it.
          </p>
          <ul className="stg:text-muted-foreground stg:list-disc stg:space-y-0.5 stg:pl-5">
            {members.map((member) => (
              <li key={member.identityAccountId}>
                {member.displayName || member.email || member.identityAccountId}
                {member.email && member.displayName ? ` (${member.email})` : ""}
                {member.automations.length > 0 &&
                  ` · ${member.automations.length} ${member.automations.length === 1 ? "automation stops" : "automations stop"}`}
                {member.invitationIds.length > 0 &&
                  ` · ${member.invitationIds.length} ${member.invitationIds.length === 1 ? "invitation stops" : "invitations stop"}`}
              </li>
            ))}
          </ul>
        </>
      )}
      {owners.length > 0 && (
        <p className="stg:text-muted-foreground">
          Owners keep their own sign-in: {owners.map((owner) => owner.displayName || owner.email || owner.identityAccountId).join(", ")}.
        </p>
      )}
      <ConfirmButtons label="Require it" isUpdating={isUpdating} onConfirm={onConfirm} onCancel={onCancel} />
    </div>
  );
}

function ConfirmButtons({
  label,
  isUpdating,
  onConfirm,
  onCancel,
}: {
  label: string;
  isUpdating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="stg:flex stg:gap-3">
      <button
        type="button"
        disabled={isUpdating}
        onClick={onConfirm}
        className="stg:rounded-md stg:bg-primary stg:px-3 stg:py-1.5 stg:font-medium stg:text-primary-foreground stg:disabled:opacity-50"
      >
        {isUpdating ? "Saving…" : label}
      </button>
      <button type="button" onClick={onCancel} className="stg:text-muted-foreground stg:hover:text-foreground">
        Cancel
      </button>
    </div>
  );
}
