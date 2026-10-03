"use client";

import { useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ProviderKey } from "@stigmer/protos/ai/stigmer/billing/providerkey/v1/api_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { Button } from "../button/index.js";
import { ApiResourceKind, useDeploymentMode, useResourceAvailable } from "../deployment-mode.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { useOrg } from "../organization/OrgProvider.js";
import { lowestPlanWith } from "./plan-features.js";
import { planUpgradeFeature, UpgradeNotice } from "./UpgradeNotice.js";
import { useEntitlements } from "./useEntitlements.js";
import { usePlans } from "./usePlans.js";
import { useProviderKeyActions, useProviderKeys, type ProviderKeyProvider } from "./useProviderKeys.js";

/** The providers, in the order the section lists them. */
const PROVIDERS: ReadonlyArray<{ readonly id: ProviderKeyProvider; readonly name: string; readonly placeholder: string }> = [
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-…" },
  { id: "openai", name: "OpenAI", placeholder: "sk-…" },
];

/** Props for {@link ProviderKeysSection}. */
export interface ProviderKeysSectionProps {
  /** Where the plans are, in the host's routing. Defaults to the billing settings route. */
  readonly billingHref?: string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Settings section for an organization's own LLM provider keys.
 *
 * On a plan that includes bring-your-own provider keys (Business and
 * above), an admin saves an Anthropic or OpenAI key, and the organization's
 * agents and workflows then run on it: the provider bills the organization
 * directly, and those tokens carry no Stigmer commission and do not count
 * toward the plan's usage share. A saved key is never shown again, only its
 * last four characters. A managed organization is served by its
 * integrator's key for a provider it holds none of, shown read-only.
 *
 * A key the plan no longer allows is kept and listed as not in use, and
 * can be removed; the organization's calls run on Stigmer's keys again,
 * billed as usage. Every member sees the list; admins
 * (`can_manage_billing`) save, replace and remove.
 *
 * Cloud-only: in local mode the runner already uses the developer's own
 * keys directly.
 *
 * @example
 * ```tsx
 * <ProviderKeysSection />
 * ```
 */
export function ProviderKeysSection({ billingHref, className }: ProviderKeysSectionProps) {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const mode = useDeploymentMode();
  const available = useResourceAvailable(ApiResourceKind.subscription);
  const org = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby={headingId} className={className}>
      <h2 id={headingId} className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold">
        Provider keys
      </h2>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Run your agents on your organization&apos;s own Anthropic and OpenAI keys. The provider bills you directly;
        those tokens carry no Stigmer commission and do not count toward your plan&apos;s usage share.
      </p>
      {mode === "local" || !available ? (
        <CloudFeatureNotice>
          Your own provider keys are a Stigmer Cloud plan feature. Local mode already calls the providers with your
          own keys directly.
        </CloudFeatureNotice>
      ) : !org ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to manage its provider keys.
        </p>
      ) : (
        <ProviderKeysContent org={org} billingHref={billingHref} />
      )}
    </section>
  );
}

function ProviderKeysContent({ org, billingHref }: { readonly org: string; readonly billingHref?: string }) {
  const listed = useProviderKeys(org);
  const entitlements = useEntitlements(org);
  const plans = usePlans();
  const manage = useCheckPermission({ kind: "organization", id: org }, "can_manage_billing");
  const canManage = !manage.isLoading && manage.allowed;
  const actions = useProviderKeyActions();
  const [editing, setEditing] = useState<ProviderKeyProvider | null>(null);

  const allowed = entitlements.allows(Feature.byo_provider_keys);
  const unlockingPlanName = lowestPlanWith(plans.plans ?? [], Feature.byo_provider_keys)?.metadata?.name;
  const keys = listed.keys ?? [];
  const refused = planUpgradeFeature(actions.error);

  const refresh = useCallback(() => {
    listed.refetch();
    entitlements.refetch();
  }, [listed, entitlements]);

  if (listed.error) {
    return <p className="stg:text-destructive stg:text-xs">{getUserMessage(listed.error)}</p>;
  }
  if (listed.keys === null || allowed === null) {
    return <p className="stg:text-muted-foreground stg:text-xs">Loading provider keys…</p>;
  }

  return (
    <div className="stg:space-y-3">
      {!allowed && (
        <UpgradeNotice feature={Feature.byo_provider_keys} unlockingPlanName={unlockingPlanName} billingHref={billingHref} />
      )}
      {!allowed && keys.length > 0 && (
        <p className="stg:text-muted-foreground stg:text-xs">
          Your saved keys are kept but not used on this plan: your agents run on Stigmer&apos;s keys, billed as usage.
          You can remove them at any time.
        </p>
      )}
      <ul
        aria-label="Provider keys"
        className={cn(UNSTYLED_LIST, "stg:divide-y stg:divide-border stg:rounded-md stg:border stg:border-border")}
      >
        {PROVIDERS.map((provider) => (
          <ProviderRow
            key={provider.id}
            org={org}
            provider={provider}
            stored={keys.find((key) => key.provider === provider.id)}
            canSave={canManage && allowed}
            canRemove={canManage}
            editing={editing === provider.id}
            onEdit={() => {
              actions.clearError();
              setEditing(provider.id);
            }}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
            onCancel={() => setEditing(null)}
            actions={actions}
          />
        ))}
      </ul>
      {refused !== null ? (
        <UpgradeNotice feature={refused} error={actions.error} billingHref={billingHref} />
      ) : actions.error ? (
        <p role="alert" className="stg:text-destructive stg:text-xs">
          {getUserMessage(actions.error)}
        </p>
      ) : null}
      <p className="stg:text-muted-foreground stg:text-[0.65rem]">
        A failure on your own key, such as a rejected key or an exhausted provider balance, is reported as your key&apos;s;
        calls are never retried on Stigmer&apos;s keys.
      </p>
    </div>
  );
}

function ProviderRow({
  org,
  provider,
  stored,
  canSave,
  canRemove,
  editing,
  onEdit,
  onDone,
  onCancel,
  actions,
}: {
  readonly org: string;
  readonly provider: (typeof PROVIDERS)[number];
  readonly stored: ProviderKey | undefined;
  readonly canSave: boolean;
  readonly canRemove: boolean;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly actions: ReturnType<typeof useProviderKeyActions>;
}) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const inherited = stored !== undefined && stored.inheritedFromOrg !== "";
  const own = stored !== undefined && !inherited;

  const save = async () => {
    try {
      await actions.setKey(org, provider.id, value.trim());
      setValue("");
      onDone();
    } catch {
      // The hook holds the error; the section renders it.
    }
  };
  const remove = async () => {
    try {
      await actions.removeKey(org, provider.id);
      setConfirming(false);
      onDone();
    } catch {
      // The hook holds the error; the section renders it.
    }
  };

  return (
    <li className="stg:space-y-2 stg:px-3 stg:py-2.5">
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          <p className="stg:text-foreground stg:text-xs stg:font-medium">{provider.name}</p>
          <p className="stg:text-muted-foreground stg:text-[0.7rem]">{describe(stored)}</p>
        </div>
        {!editing && !confirming && (
          <div className="stg:flex stg:shrink-0 stg:gap-2">
            {canSave && !inherited && (
              <Button size="sm" variant="outline" onClick={onEdit} disabled={actions.isSubmitting}>
                {own ? "Replace" : "Add key"}
              </Button>
            )}
            {canRemove && own && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  actions.clearError();
                  setConfirming(true);
                }}
                disabled={actions.isSubmitting}
              >
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
      {confirming && (
        <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-2 stg:rounded-md stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-2.5 stg:py-2">
          <p className="stg:text-foreground stg:min-w-0 stg:flex-1 stg:text-xs">
            {stored?.inUse
              ? `Remove your ${provider.name} key? Your agents' ${provider.name} calls go back to Stigmer's keys, billed as usage.`
              : `Remove your ${provider.name} key? It is not in use on this plan.`}
          </p>
          <div className="stg:flex stg:shrink-0 stg:gap-2">
            <Button size="sm" variant="destructive" onClick={() => void remove()} disabled={actions.isSubmitting}>
              {actions.isSubmitting ? "Removing…" : "Remove key"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={actions.isSubmitting}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {editing && (
        <form
          className="stg:flex stg:flex-wrap stg:items-end stg:gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="stg:min-w-48 stg:flex-1 stg:space-y-1">
            <label htmlFor={inputId} className="stg:text-foreground stg:text-xs stg:font-medium">
              {provider.name} API key
            </label>
            <input
              id={inputId}
              type="password"
              autoComplete="off"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={provider.placeholder}
              disabled={actions.isSubmitting}
              className={cn(
                "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
                "stg:placeholder:text-muted-foreground",
                "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              )}
            />
          </div>
          <Button size="sm" type="submit" disabled={actions.isSubmitting || value.trim() === ""}>
            {actions.isSubmitting ? "Saving…" : "Save key"}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={onCancel} disabled={actions.isSubmitting}>
            Cancel
          </Button>
        </form>
      )}
    </li>
  );
}

/** One line about a provider's key: none, own, or inherited, with its use. */
function describe(key: ProviderKey | undefined): string {
  if (key === undefined) {
    return "Not set: calls run on Stigmer's keys, billed as usage.";
  }
  const parts = [`Key ending in ${key.keyHint}`];
  if (key.inheritedFromOrg !== "") {
    parts.push(`provided by ${key.inheritedFromOrg}`);
  } else if (key.updatedAt !== undefined) {
    parts.push(`saved ${formatDay(timestampDate(key.updatedAt))}`);
  }
  parts.push(key.lastUsedAt === undefined ? "not used yet" : `last used ${formatDay(timestampDate(key.lastUsedAt))}`);
  if (!key.inUse) {
    parts.push("not in use on this plan");
  }
  return parts.join(" · ");
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
