"use client";

// Models & providers: which models an organization's agents can run, the
// providers behind them, and the person's default model per engine. Every
// fact about a provider's standing is the server's readiness answer, which
// every member may read; on Stigmer Cloud the key list (which members may
// read too) adds each key's details, and only `can_manage_billing` decides
// who gets the form. `useModelsHubData` is the data layer the launcher's
// connect step reads as well, so the two faces can never disagree.

import { useCallback, useId, useMemo } from "react";
import { cn } from "@stigmer/design-tokens";
import type { ProviderKey } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import { ErrorMessage } from "../../error/ErrorMessage.js";
import { useProviderKeys } from "../../billing/useProviderKeys.js";
import { useDeploymentMode, useResourceAvailable } from "@stigmer/react-core";
import { ApiResourceKind } from "@stigmer/react-core/internal";
import { useCheckPermission } from "../../grant/useCheckPermission.js";
import { LoadingRegion } from "../../internal/LoadingRegion.js";
import { useKnownOrgs } from "../../organization/OrgProvider.js";
import { PageHeader } from "../../page/PageHeader.js";
import type { ModelReadinessLookup, ProviderReadiness } from "../readiness.js";
import { modelKey } from "@stigmer/react-core";
import { useModelReadiness } from "../useModelReadiness.js";
import { useModelRegistry } from "../useModelRegistry.js";
import { ModelDefaults } from "./ModelDefaults.js";
import { ProviderCard, type NamedModelReadiness, type ProviderViewer } from "./ProviderCard.js";

/** What the hub and the launcher's connect step draw from. */
export interface ModelsHubData {
  readonly org: string;
  /** The organization's name as people read it. */
  readonly orgName: string;
  /** Who is looking: whether they may manage keys, and whether the server runs on this machine. */
  readonly viewer: ProviderViewer;
  /** Each provider's report, in the server's order; `null` until the server answers. */
  readonly providers: readonly ProviderReadiness[] | null;
  /** Every model on every engine, named by the registry; `null` until the server answers. */
  readonly models: readonly NamedModelReadiness[] | null;
  /** The key that serves a provider, own or inherited, when the key list is readable (Stigmer Cloud). */
  readonly keyOf: (provider: string) => ProviderKey | undefined;
  /** The parent organization's name, for a provider its key serves. */
  readonly parentOrgNameOf: (provider: string) => string | undefined;
  readonly readinessOf: ModelReadinessLookup;
  /** `true` until the readiness answer and, where it matters, the permission check have settled. */
  readonly isLoading: boolean;
  /**
   * `true` until the readiness answer alone has settled. What can run is
   * known before who may connect a provider, so a face that chooses by
   * readiness (the launcher's composer or connect step) chooses on this.
   */
  readonly readinessLoading: boolean;
  /** The readiness read's error, or `null`. */
  readonly error: Error | null;
  /** Asks the server again for readiness and the key list, after a key is saved or removed. */
  readonly refresh: () => void;
}

/**
 * Data hook for Models & providers and the launcher's connect step:
 * readiness from the server, model names from the registry, each key's
 * details on Stigmer Cloud, and who is looking. `org` null skips every read.
 *
 * @example
 * ```tsx
 * function ProviderCount() {
 *   const hub = useModelsHubData("acme");
 *   if (hub.providers === null) return null;
 *   return <p>{hub.providers.length} providers</p>;
 * }
 * ```
 */
export function useModelsHubData(org: string | null): ModelsHubData {
  const orgId = org ?? "";
  const readiness = useModelReadiness(org);
  const { getByKey } = useModelRegistry();
  const keysReadable = useResourceAvailable(ApiResourceKind.subscription);
  const keys = useProviderKeys(org, { enabled: keysReadable });
  const local = useDeploymentMode() === "local";
  const knownOrgs = useKnownOrgs();

  // Who may save and remove keys matters only where the organization holds
  // them: a key it is missing, or an own key to replace or remove.
  const asksPermission =
    orgId !== "" &&
    (readiness.providers ?? []).some(
      ({ availability }) =>
        (availability.state === "missing" && availability.scope === "organization") ||
        (availability.state === "served" && availability.source === "organization"),
    );
  const manage = useCheckPermission(asksPermission ? { kind: "organization", id: orgId } : null, "can_manage_billing");

  const nameOfOrg = useCallback(
    (ref: string): string | undefined => {
      if (ref === "") return undefined;
      const known = knownOrgs?.find((entry) => entry.metadata?.id === ref || entry.metadata?.slug === ref);
      return known?.metadata?.name || known?.metadata?.slug || undefined;
    },
    [knownOrgs],
  );

  const models = useMemo(
    () =>
      readiness.models === null
        ? null
        : readiness.models.map((model) => ({
            ...model,
            displayName: getByKey(modelKey(model.harness, model.modelId))?.displayName || model.modelId,
          })),
    [readiness.models, getByKey],
  );

  const keyList = keys.keys;
  const keyOf = useCallback((provider: string) => keyList?.find((key) => key.provider === provider), [keyList]);

  const providerList = readiness.providers;
  const parentOrgNameOf = useCallback(
    (provider: string): string | undefined => {
      const inherited = keyList?.find((key) => key.provider === provider)?.inheritedFromOrg ?? "";
      if (inherited !== "") return nameOfOrg(inherited) ?? inherited;
      const report = providerList?.find((entry) => entry.provider === provider);
      const parent = report?.availability.state === "served" ? report.availability.parentOrg : "";
      return parent === "" ? undefined : (nameOfOrg(parent) ?? parent);
    },
    [keyList, providerList, nameOfOrg],
  );

  const { refetch: refetchReadiness } = readiness;
  const { refetch: refetchKeys } = keys;
  const refresh = useCallback(() => {
    refetchReadiness();
    if (keysReadable) refetchKeys();
  }, [refetchReadiness, refetchKeys, keysReadable]);

  const canManage = asksPermission && !manage.isLoading && manage.allowed;
  const readinessLoading = readiness.providers === null && readiness.error === null && orgId !== "";
  const isLoading = readinessLoading || (readiness.providers !== null && asksPermission && manage.isLoading);

  return useMemo(
    () => ({
      org: orgId,
      orgName: nameOfOrg(orgId) ?? "this organization",
      viewer: { canManage, local },
      providers: readiness.providers,
      models,
      keyOf,
      parentOrgNameOf,
      readinessOf: readiness.readinessOf,
      isLoading,
      readinessLoading,
      error: readiness.error,
      refresh,
    }),
    [
      orgId,
      nameOfOrg,
      canManage,
      local,
      readiness.providers,
      models,
      keyOf,
      parentOrgNameOf,
      readiness.readinessOf,
      isLoading,
      readinessLoading,
      readiness.error,
      refresh,
    ],
  );
}

/** Props for {@link ModelsHub}. */
export interface ModelsHubProps {
  /** The organization (id or slug) whose providers the hub shows. */
  readonly org: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Models & providers: which models this organization's agents can run, a
 * card per provider with the models it unlocks on each engine and the act
 * the person looking can take, and their default model per engine.
 *
 * @example
 * ```tsx
 * <ModelsHub org={useActiveOrgId()} />
 * ```
 */
export function ModelsHub({ org, className }: ModelsHubProps) {
  const hub = useModelsHubData(org === "" ? null : org);
  return (
    <div className={cn("stg:space-y-6", className)}>
      <PageHeader
        title="Models & providers"
        description={
          hub.viewer.local
            ? "Which models your agents can run on this machine, and the providers behind them."
            : `Which models ${hub.orgName}'s agents can run, and the provider keys behind them.`
        }
        headingLevel={1}
      />
      <HubBody hub={hub} />
    </div>
  );
}

function HubBody({ hub }: { readonly hub: ModelsHubData }) {
  const providersHeadingId = useId();
  if (hub.providers === null || hub.models === null) {
    if (hub.error !== null) {
      return <ErrorMessage error={hub.error} retry={hub.refresh} />;
    }
    return <HubSkeleton />;
  }
  if (hub.isLoading) return <HubSkeleton />;
  const models = hub.models;
  return (
    <>
      <section aria-labelledby={providersHeadingId} className="stg:space-y-3">
        <h2 id={providersHeadingId} className="stg:text-sm stg:font-semibold stg:text-foreground">
          Providers
        </h2>
        {hub.providers.map((report) => (
          <ProviderCard
            key={report.provider}
            org={hub.org}
            orgName={hub.orgName}
            report={report}
            storedKey={hub.keyOf(report.provider)}
            parentOrgName={hub.parentOrgNameOf(report.provider)}
            viewer={hub.viewer}
            models={models.filter((model) => model.provider === report.provider)}
            onChanged={hub.refresh}
          />
        ))}
      </section>
      <ModelDefaults readinessOf={hub.readinessOf} />
    </>
  );
}

function HubSkeleton() {
  return (
    <LoadingRegion label="Loading models and providers" className="stg:space-y-3">
      <div className="stg:h-28 stg:animate-pulse stg:rounded-xl stg:bg-muted-subtle" />
      <div className="stg:h-28 stg:animate-pulse stg:rounded-xl stg:bg-muted-subtle" />
    </LoadingRegion>
  );
}
