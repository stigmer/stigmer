"use client";

// The platform operator's licenses console, inside the shared settings
// frame: the renewal calendar, the issue form and each license's detail.
// The frame says when this edition issues no licenses and when the person
// is not a platform operator, in words rather than the transport's error.

import { useCallback, useState, type ReactNode } from "react";
import { FileBadge, Plus, RefreshCw } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import { isPermissionDenied, isUnimplemented, type LicenseInput } from "@stigmer/client";
import type { License } from "@stigmer/apis/ai/stigmer/billing/license/v1/api_pb";
import { LicenseState } from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";
import { Button } from "../button/index.js";
import { useResourceAvailable } from "@stigmer/react-core";
import { ApiResourceKind } from "@stigmer/react-core/internal";
import { EmptyState } from "../empty-state/index.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Table, type TableColumn } from "../internal/surface/Table.js";
import { SettingsPage, type SettingsPageBack } from "../settings/SettingsPage.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { StatusBadge } from "../status/StatusBadge.js";
import { deriveLicenseCustomers } from "./license-customers.js";
import {
  coveredThroughDay,
  entitlementParts,
  formatDayFromToday,
  termLabel,
  toDate,
} from "./license-format.js";
import {
  deriveLicenseStandings,
  sortForCalendar,
  type LicenseStanding,
} from "./license-standing.js";
import { LicenseDetail, LicenseStandingLine } from "./LicenseDetail.js";
import { LicenseIssueForm } from "./LicenseIssueForm.js";
import { LICENSES_DENIAL } from "./LicensesAccessNotice.js";
import { useIssueLicense } from "./useIssueLicense.js";
import { useLicenses } from "./useLicenses.js";

/** Props for {@link LicensesConsole}. */
export interface LicensesConsoleProps {
  /** Additional CSS class names. */
  readonly className?: string;
  /**
   * The clock the calendar reads. Defaults to the time of each render;
   * pass a fixed instant for deterministic hosts (tests, demo fixtures).
   */
  readonly now?: Date;
}

const ICON = "stg:size-3.5";

/** What the console is for, under its title on the list, the issue form and a failed read. */
const LICENSES_PURPOSE = "Every Stigmer license issued, ordered by when it needs renewing.";

type Flow =
  | { readonly phase: "list" }
  | { readonly phase: "issue"; readonly renewingId?: string }
  | { readonly phase: "detail"; readonly licenseId: string; readonly issued?: License };

/**
 * The platform-operator console for Stigmer licenses: the renewal calendar
 * of every license issued, the form that issues one, and each license's
 * detail with its signed ticket.
 *
 * - **Calendar**: every license with what needs action first. A license
 *   renewed by a later one is muted: it needs nothing. A calendar that
 *   failed to load still offers Issue license: issuing needs no list.
 * - **Issue**: from scratch, or as a renewal pre-filled from the customer's
 *   current license. An issue lands on the new license's detail, its ticket
 *   ready to copy.
 * - **Detail**: the customer's name as the page's title, as every settings
 *   detail is titled, its standing under it, the license's terms, the
 *   ticket on demand, and Renew on the customer's current license.
 *
 * Requires `can_issue_license` on `platform:stigmer`; anyone else sees the
 * designed access notice. On an edition that does not issue licenses the
 * console says so, whether the provider's edition or the server's answer
 * arrives first.
 *
 * @example
 * ```tsx
 * <LicensesConsole />
 * ```
 */
export function LicensesConsole({ className, now }: LicensesConsoleProps) {
  const available = useResourceAvailable(ApiResourceKind.license);
  const list = useLicenses({ enabled: available });
  const issuer = useIssueLicense();
  const [flow, setFlow] = useState<Flow>({ phase: "list" });
  const renderNow = now ?? new Date();

  const backToList = useCallback(() => setFlow({ phase: "list" }), []);
  const startIssue = useCallback(
    (renewingId?: string) => {
      issuer.clearError();
      setFlow({ phase: "issue", renewingId });
    },
    [issuer.clearError],
  );

  const unavailable = !available || (list.error !== null && isUnimplemented(list.error));
  const denied = !unavailable && list.error !== null && isPermissionDenied(list.error);
  const issueAction = (
    <Button icon={<Plus className={ICON} aria-hidden="true" />} onClick={() => startIssue()}>
      Issue license
    </Button>
  );
  const frame = (
    body: ReactNode,
    extra?: {
      readonly title?: string;
      readonly description?: ReactNode;
      readonly actions?: ReactNode;
      readonly back?: SettingsPageBack;
    },
  ) => (
    <SettingsPage
      title={extra?.title ?? "Licenses"}
      description={extra?.description ?? LICENSES_PURPOSE}
      actions={extra?.actions}
      back={extra?.back}
      unavailable={
        unavailable &&
        "Licenses come with Stigmer Cloud, which issues them. On this edition no license is issued; sign in to Stigmer Cloud to issue or renew one."
      }
      denied={denied ? LICENSES_DENIAL : false}
      className={className}
    >
      {body}
    </SettingsPage>
  );

  if (unavailable || denied) {
    return frame(null);
  }

  if (list.isLoading) {
    return frame(<SettingsSkeleton label="Loading licenses" rows={3} />);
  }

  // A failed read still offers Issue license, and the issue form opens
  // from it: issuing needs no list.
  if (list.error && flow.phase !== "issue") {
    return frame(<ErrorMessage error={list.error} title="Couldn't load the licenses." retry={list.refetch} />, {
      actions: issueAction,
    });
  }

  // A just-issued license is shown before the list's refetch returns it.
  const issued = flow.phase === "detail" ? flow.issued : undefined;
  const licenses =
    issued && !(list.licenses ?? []).some((l) => l.metadata?.id === issued.metadata?.id)
      ? [...(list.licenses ?? []), issued]
      : (list.licenses ?? []);
  const standings = deriveLicenseStandings(licenses, renderNow);
  const findLicense = (id: string | undefined) =>
    id === undefined ? undefined : licenses.find((l) => l.metadata?.id === id);

  if (flow.phase === "issue") {
    return frame(
      <LicenseIssueForm
        customers={deriveLicenseCustomers(licenses)}
        renewing={findLicense(flow.renewingId)}
        now={renderNow}
        isSubmitting={issuer.isSubmitting}
        submitError={issuer.error}
        onSubmit={(input: LicenseInput) => {
          void issuer.issue(input).then(
            (license) => {
              list.refetch();
              setFlow({ phase: "detail", licenseId: license.metadata?.id ?? "", issued: license });
            },
            () => {
              // Surfaced via submitError.
            },
          );
        }}
        onCancel={backToList}
      />,
    );
  }

  // A detail whose license the list no longer holds falls through to the
  // calendar, as the model catalog's stale detail does, rather than drawing
  // a page about nothing.
  const detail = flow.phase === "detail" ? findLicense(flow.licenseId) : undefined;
  if (flow.phase === "detail" && detail) {
    const standing = standings.get(flow.licenseId);
    const licenseId = flow.licenseId;
    return frame(
      <LicenseDetail key={licenseId} license={detail} issued={flow.issued} now={renderNow} />,
      {
        title: detail.spec?.customer?.displayName ?? "Unknown customer",
        back: { label: "Licenses", onBack: backToList },
        description: <LicenseStandingLine license={detail} standing={standing} now={renderNow} />,
        // Renew only on the customer's current license.
        actions:
          standing && !standing.renewedBy ? (
            <Button variant="outline" icon={<RefreshCw className={ICON} aria-hidden="true" />} onClick={() => startIssue(licenseId)}>
              Renew
            </Button>
          ) : undefined,
      },
    );
  }

  const sorted = sortForCalendar(licenses, standings);

  return frame(
    licenses.length === 0 ? (
      <EmptyState
        variant="first-use"
        icon={<FileBadge aria-hidden="true" />}
        title="No licenses issued yet"
        description="Issue the first one: name the customer, choose the term and set what it unlocks. Every license appears here, ordered by when it needs renewing."
        action={{
          label: "Issue license",
          onClick: () => startIssue(),
          icon: <Plus className={ICON} aria-hidden="true" />,
        }}
      />
    ) : (
      <Table
        aria-label="Licenses"
        columns={licenseColumns(standings, renderNow)}
        rows={sorted}
        rowKey={(license) => license.metadata?.id ?? ""}
        onRowClick={(license) => setFlow({ phase: "detail", licenseId: license.metadata?.id ?? "" })}
      />
    ),
    licenses.length > 0 ? { actions: issueAction } : undefined,
  );
}

/**
 * The calendar's columns: the customer and its address, the term, what the
 * license allows, the day it is covered through (or, in grace, the day the
 * grace ends), and its standing. A renewed or expired license is history,
 * drawn muted so what needs action reads first.
 */
function licenseColumns(
  standings: ReadonlyMap<string, LicenseStanding>,
  now: Date,
): readonly TableColumn<License>[] {
  const standingOf = (license: License) => standings.get(license.metadata?.id ?? "");
  const history = (license: License) => standingOf(license)?.phase === "disabled";
  return [
    {
      id: "customer",
      header: "Customer",
      cell: (license) => (
        <span className={cn(history(license) && "stg:text-muted-foreground")}>
          {license.spec?.customer?.displayName ?? "Unknown customer"}
        </span>
      ),
      detail: (license) => license.spec?.customer?.contactEmail,
    },
    {
      id: "term",
      header: "Term",
      cell: (license) => (license.spec ? termLabel(license.spec.term) : "—"),
    },
    {
      id: "limits",
      header: "Limits",
      cell: (license) => (
        <span className="stg:text-muted-foreground">{entitlementParts(license.spec?.entitlements).join(" · ")}</span>
      ),
    },
    {
      id: "through",
      header: "Covered through",
      cell: (license) => {
        const standing = standingOf(license);
        const expiresAt = toDate(license.spec?.expiresAt);
        const through = expiresAt ? coveredThroughDay(expiresAt) : undefined;
        const graceUntil = toDate(license.spec?.graceUntil);
        // In grace, the deadline that matters is when growth stops: the
        // grace end, not the coverage that already lapsed.
        const inGrace = standing?.timeState === LicenseState.grace && !standing.renewedBy && graceUntil;
        return (
          <span className="stg:flex stg:flex-col">
            <span className={cn("stg:whitespace-nowrap", history(license) && "stg:text-muted-foreground")}>
              {through ?? "Unknown"}
            </span>
            {inGrace ? (
              <span className="stg:whitespace-nowrap stg:text-xs stg:font-medium stg:text-destructive">
                {`Grace ends ${coveredThroughDay(inGrace)}`}
              </span>
            ) : (
              through && (
                <span className="stg:whitespace-nowrap stg:text-xs stg:text-muted-foreground">
                  {formatDayFromToday(through, now)}
                </span>
              )
            )}
          </span>
        );
      },
    },
    {
      id: "standing",
      header: "State",
      narrow: "trailing",
      cell: (license) => {
        const standing = standingOf(license);
        return standing ? (
          // Above the row's stretched button, so the badge's tooltip stays reachable.
          <span className="stg:relative stg:z-10">
            <StatusBadge phase={standing.phase} label={standing.label} tooltip={standing.reason} />
          </span>
        ) : null;
      },
    },
  ];
}
