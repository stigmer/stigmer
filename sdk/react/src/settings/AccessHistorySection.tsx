"use client";

/**
 * The Access history settings page: every time someone in the organization
 * was given or lost access, who did it, why and when, newest first, and a
 * download of the whole history as JSON Lines for a security team's tools.
 *
 * Who sees what:
 *   - on open source, which keeps no history, the page says so;
 *   - on Stigmer Cloud, where the organization's plan lacks the history,
 *     the plan notice names the cheapest plan that includes it; the
 *     history is still recorded, so upgrading reads the whole past;
 *   - otherwise the organization's owners and admins (and a parent's
 *     admins for a child, `can_view_access_history`) read it; anyone else
 *     is told who does.
 *
 * Above the rows, one line says how long the server keeps the history
 * ("Entries older than 365 days are removed", or "Kept for good"): its
 * operator decides, and the oldest entries go first.
 *
 * Each row names people as the access list does, as they are called today
 * (the server names them at read time). A change the server made on a
 * person's behalf (an invitation's redemption, a departure's sweep) reads
 * "The server, on behalf of …". A resource that has since been deleted
 * reads as its kind and "deleted".
 *
 * The download follows the history oldest first through `@stigmer/sdk`'s
 * `exportAccessHistory`, the same JSON Lines the CLI's
 * `stigmer access-history export` writes.
 */
import { useCallback, useId, useState } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { cn } from "@stigmer/theme";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  AccessChange,
  AccessChangeCause,
  type AccessHistoryEntry,
  type ApiResourceRefView,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/io_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import {
  accessHistoryJsonLine,
  deletedReferenceLabel,
  exportAccessHistory,
  getUserMessage,
  isDeletedReference,
} from "@stigmer/sdk";
import { UpgradeNotice, planUpgradeFeature } from "../billing/UpgradeNotice.js";
import { unlockingPlanName } from "../billing/plan-features.js";
import { useEntitlements } from "../billing/useEntitlements.js";
import { usePlans } from "../billing/usePlans.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { useStigmer } from "../hooks.js";
import { PermissionGate } from "../grant/PermissionGate.js";
import { useAccessHistory } from "../grant/useAccessHistory.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { downloadTextFile } from "../internal/download.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { useOrg } from "../organization/OrgProvider.js";

/** Shown in place of the history to a caller who may not read it. */
const READ_BY_ADMINS = "The access history is read by your organization's owners and admins.";

/** Settings section for an organization's access history. */
export function AccessHistorySection() {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.metadata?.id ?? "";
  const mode = useDeploymentMode();
  const keepsHistory = mode !== "local";

  const onCloud = mode === "cloud";
  const plan = useEntitlements(orgId || null, { enabled: onCloud });
  const planLacksHistory = plan.allows(Feature.access_history) === false;
  const catalog = usePlans({ enabled: planLacksHistory });
  const unlockingPlan = unlockingPlanName(catalog.plans ?? [], Feature.access_history);

  return (
    <section aria-labelledby={headingId}>
      <div className="stg:mb-3">
        <h2 id={headingId} className="stg:text-foreground stg:text-sm stg:font-semibold">
          Access history
        </h2>
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Every time someone was given or lost access to this organization or
        anything in it: who did it, why, and when. The history starts when
        your server began keeping it; nothing earlier is filled in.
      </p>

      {!keepsHistory ? (
        <CloudFeatureNotice>
          The access history is kept by Stigmer Enterprise and Cloud. This
          edition keeps no record of access changes.
        </CloudFeatureNotice>
      ) : !orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to read its access history.
        </p>
      ) : planLacksHistory ? (
        <UpgradeNotice feature={Feature.access_history} unlockingPlanName={unlockingPlan} />
      ) : (
        <PermissionGate
          resource={{ kind: "organization", id: orgId }}
          relation="can_view_access_history"
          fallback={
            <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">{READ_BY_ADMINS}</p>
          }
        >
          <AccessHistoryList org={orgId} />
        </PermissionGate>
      )}
    </section>
  );
}

/** The history itself, for a caller the server lets read it. */
function AccessHistoryList({ org }: { readonly org: string }) {
  const history = useAccessHistory(org);
  const download = useDownloadAccessHistory(org);

  if (history.isLoading) {
    return (
      <LoadingRegion className="stg:space-y-2" label="Loading the access history">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="stg:bg-muted-subtle stg:h-10 stg:animate-pulse stg:rounded-lg" />
        ))}
      </LoadingRegion>
    );
  }

  if (history.error) {
    const feature = planUpgradeFeature(history.error);
    return feature !== null ? (
      <UpgradeNotice feature={feature} error={history.error} />
    ) : (
      <p className="stg:text-destructive stg:text-xs" role="alert">
        {getUserMessage(history.error)}
      </p>
    );
  }

  return (
    <div className="stg:space-y-3">
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
        <p className="stg:text-muted-foreground stg:text-xs">{retentionWords(history.retention?.days ?? 0)}</p>
        <button
          type="button"
          onClick={download.run}
          disabled={download.isRunning || history.entries.length === 0}
          className="stg:text-primary stg:hover:text-foreground stg:text-xs stg:font-medium stg:transition-colors stg:disabled:opacity-50"
        >
          {download.isRunning ? "Preparing…" : "Download JSON Lines"}
        </button>
      </div>
      {download.error !== null && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(download.error)}
        </p>
      )}

      {history.entries.length === 0 ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          No access changes recorded yet.
        </p>
      ) : (
        <ol aria-label="Access changes" className={cn(UNSTYLED_LIST, "stg:space-y-1")}>
          {history.entries.map((entry) => (
            <AccessHistoryRow key={entry.sequence.toString()} entry={entry} />
          ))}
        </ol>
      )}

      {history.loadMoreError !== null && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(history.loadMoreError)}
        </p>
      )}
      {history.hasMore && (
        <button
          type="button"
          onClick={history.loadMore}
          disabled={history.isLoadingMore}
          className="stg:text-primary stg:text-xs stg:font-medium stg:hover:underline stg:disabled:opacity-50"
        >
          {history.isLoadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

/** One change, as a sentence and the reason under it. */
function AccessHistoryRow({ entry }: { readonly entry: AccessHistoryEntry }) {
  const when = entry.occurredAt === undefined ? "" : WHEN.format(timestampDate(entry.occurredAt));
  const role = entry.role?.name || entry.role?.code || "a";
  const grantee = granteeName(entry.principal);
  const what = resourceName(entry);
  const sentence =
    entry.change === AccessChange.revoked
      ? `${actorName(entry)} removed ${grantee}'s ${role} role on ${what}`
      : `${actorName(entry)} gave ${grantee} the ${role} role on ${what}`;
  return (
    <li className="stg:rounded-md stg:px-2 stg:py-1.5 stg:hover:bg-accent-hover">
      <p className="stg:text-foreground stg:text-xs">{sentence}</p>
      <p className="stg:text-muted-foreground stg:text-[0.6rem]">
        {when ? `${when} · ` : ""}
        {CAUSE_WORDS[entry.cause] ?? CAUSE_WORDS[AccessChangeCause.access_change_cause_unspecified]}
        {` · #${entry.sequence.toString()}`}
      </p>
    </li>
  );
}

/** How long the server keeps the history, in a person's words. */
function retentionWords(days: number): string {
  if (days <= 0) {
    return "Kept for good";
  }
  return `Entries older than ${days} ${days === 1 ? "day" : "days"} are removed`;
}

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Why a change happened, in a person's words. */
const CAUSE_WORDS: Readonly<Record<AccessChangeCause, string>> = {
  [AccessChangeCause.access_change_cause_unspecified]: "Other change",
  [AccessChangeCause.grant]: "Granted",
  [AccessChangeCause.revoke]: "Removed",
  [AccessChangeCause.structural]: "Set by the resource's creation or visibility",
  [AccessChangeCause.organization_access_revoked]: "Removed from the organization",
  [AccessChangeCause.left_organization]: "Left the organization",
  [AccessChangeCause.resource_deleted]: "The resource was deleted",
  [AccessChangeCause.organization_created]: "Created the organization",
  [AccessChangeCause.first_sign_in]: "First sign-in",
  [AccessChangeCause.role_reconciliation]: "Membership rules applied",
  [AccessChangeCause.operator_ownership]: "The server's operator took ownership",
  [AccessChangeCause.platform_client_grant]: "Signed in from your product",
  [AccessChangeCause.service_account_created]: "Service account created",
};

function personName(view: ApiResourceRefView | undefined): string {
  return view?.name || view?.email || view?.id || "someone";
}

/** Who made the change; the server when it acted on someone's behalf. */
function actorName(entry: AccessHistoryEntry): string {
  if (entry.actorClass !== "internal") {
    return personName(entry.actor);
  }
  return entry.actor?.id ? `The server, on behalf of ${personName(entry.actor)},` : "The server";
}

/** Who was given or lost access: a person, or a group named by its relation. */
function granteeName(principal: ApiResourceRefView | undefined): string {
  const name = personName(principal);
  if (principal === undefined || principal.relation === "") {
    return principal?.kind === "team" ? `team ${name}` : name;
  }
  return `the ${principal.relation}s of ${principal.kind.replace(/_/g, " ")} ${name}`;
}

/** What the access was to: the resource by its current name, or "deleted". */
function resourceName(entry: AccessHistoryEntry): string {
  const resource = entry.resource;
  if (resource === undefined) {
    return "a resource";
  }
  if (isDeletedReference(resource)) {
    return `a ${deletedReferenceLabel(resource.kind)}`;
  }
  const kind = ApiResourceKind[resource.kind]?.replace(/_/g, " ") ?? "resource";
  return `${kind} ${resource.slug || resource.id}`;
}

/** Downloads the whole history, oldest first, as JSON Lines. */
function useDownloadAccessHistory(org: string) {
  const stigmer = useStigmer();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const run = useCallback(async () => {
    setIsRunning(true);
    setError(null);
    try {
      const lines: string[] = [];
      for await (const entry of exportAccessHistory(stigmer.grant, org)) {
        lines.push(accessHistoryJsonLine(entry));
      }
      downloadTextFile(`${lines.join("\n")}\n`, `access-history-${org}.jsonl`, "application/jsonl");
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown : new Error(String(thrown)));
    } finally {
      setIsRunning(false);
    }
  }, [org, stigmer]);
  return { run, isRunning, error };
}
