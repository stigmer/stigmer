"use client";

// The platform operator's licenses console, inside the shared settings
// frame: the renewal calendar, the issue form and each license's detail.
// The frame says when this edition issues no licenses and when the person
// is not a platform operator, in words rather than the transport's error.

import { useCallback, useState, type ReactNode } from "react";
import { FileBadge, Plus } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import { isPermissionDenied, isUnimplemented, type LicenseInput } from "@stigmer/client";
import type { License } from "@stigmer/apis/ai/stigmer/billing/license/v1/api_pb";
import { LicenseState } from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";
import { Button } from "../button/index.js";
import { useResourceAvailable } from "@stigmer/react-core";
import { ApiResourceKind } from "@stigmer/react-core/internal";
import { EmptyState } from "../empty-state/index.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { SettingsPage } from "../settings/SettingsPage.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { StatusBadge } from "../resource-workbench/components/StatusBadge.js";
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
  summarizeCalendar,
  type LicenseStanding,
} from "./license-standing.js";
import { LicenseDetail } from "./LicenseDetail.js";
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

/** What the console is for, under its title when there is no calendar summary to show. */
const LICENSES_PURPOSE = "Every Stigmer license issued, ordered by when it needs renewing.";

type Flow =
  | { readonly phase: "list" }
  | { readonly phase: "issue"; readonly renewingId?: string }
  | { readonly phase: "detail"; readonly licenseId: string; readonly issued?: License };

/**
 * One grid template shared by the header and every row so the columns
 * can never drift apart: Customer · Term · Entitlements · Covered through ·
 * Standing.
 *
 * The budget was sized for the narrowest column a host gives it: about
 * 720px of content (both client apps now give settings `max-w-5xl`). Fixed tracks total 19rem (the
 * covered-through track holds "Grace ends YYYY-MM-DD" on one line), leaving
 * the two flexible columns about 340px between them, weighted to the
 * customer (the name identifies the row, so it is the last to truncate)
 * over the entitlement parts, stacked one per line (the grid-collapse class of
 * stigmer#929 is what this guards against). Below the grid's legible
 * minimum (42rem, which still leaves the customer column about 150px) the
 * table scrolls instead of crushing a column.
 */
const ROW_GRID =
  "stg:grid stg:grid-cols-[minmax(0,2fr)_4rem_minmax(0,1.4fr)_9rem_6rem] stg:items-center stg:gap-3 stg:px-3 stg:py-2";

/**
 * The platform-operator console for Stigmer licenses: the renewal calendar
 * of every license issued, the form that issues one, and each license's
 * detail with its signed ticket.
 *
 * - **Calendar**: one line saying how many customers are active, expiring
 *   and in grace, then every license with what needs action first. A
 *   license renewed by a later one is muted: it needs nothing.
 * - **Issue**: from scratch, or as a renewal pre-filled from the customer's
 *   current license. An issue lands on the new license's detail, its ticket
 *   ready to copy.
 * - **Detail**: the license's terms, the ticket on demand, and Renew on the
 *   customer's current license.
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
  const frame = (body: ReactNode, extra?: { readonly description?: string; readonly actions?: ReactNode }) => (
    <SettingsPage
      title="Licenses"
      description={extra?.description ?? LICENSES_PURPOSE}
      actions={extra?.actions}
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

  if (list.error) {
    return frame(<ErrorMessage error={list.error} title="The licenses could not be read" retry={list.refetch} />);
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
    return frame(
      <LicenseDetail
        key={flow.licenseId}
        license={detail}
        issued={flow.issued}
        standing={standing}
        now={renderNow}
        onBack={backToList}
        onRenew={standing && !standing.renewedBy ? () => startIssue(flow.licenseId) : undefined}
      />,
    );
  }

  const sorted = sortForCalendar(licenses, standings);
  const summary = summarizeCalendar(standings);

  return frame(
    licenses.length === 0 ? (
      <EmptyState
        variant="first-use"
        icon={<FileBadge className="stg:size-10" aria-hidden="true" />}
        title="No licenses issued yet"
        description="Issue the first one: name the customer, choose the term and set what it unlocks. Every license appears here, ordered by when it needs renewing."
        action={{
          label: "Issue license",
          onClick: () => startIssue(),
          icon: <Plus className={ICON} aria-hidden="true" />,
        }}
        className="stg:rounded-lg stg:border stg:border-dashed stg:border-border"
      />
    ) : (
      // Narrow-host guard (the ResourceTable idiom): the scroll container
      // carries the card chrome and the ARIA table starts inside it, so
      // rows stay directly owned by the table.
      <div className="stg:overflow-x-auto stg:rounded-lg stg:border stg:border-border stg:bg-card">
        <div role="table" aria-label="Licenses" className="stg:min-w-[42rem]">
          <div
            role="row"
            className={cn(ROW_GRID, "stg:border-b stg:border-border stg:text-xs stg:font-medium stg:text-muted-foreground")}
          >
            <span role="columnheader">Customer</span>
            <span role="columnheader">Term</span>
            <span role="columnheader">Entitlements</span>
            <span role="columnheader">Covered through</span>
            <span role="columnheader">Standing</span>
          </div>
          <div role="rowgroup">
            {sorted.map((license) => (
              <LicenseRow
                key={license.metadata?.id}
                license={license}
                standing={standings.get(license.metadata?.id ?? "")}
                now={renderNow}
                onOpen={() => setFlow({ phase: "detail", licenseId: license.metadata?.id ?? "" })}
              />
            ))}
          </div>
        </div>
      </div>
    ),
    licenses.length > 0
      ? {
          description: `${summary.active} active · ${summary.expiring} expiring · ${summary.grace} in grace`,
          actions: (
            <Button icon={<Plus className={ICON} aria-hidden="true" />} onClick={() => startIssue()}>
              Issue license
            </Button>
          ),
        }
      : undefined,
  );
}

function LicenseRow({
  license,
  standing,
  now,
  onOpen,
}: {
  readonly license: License;
  readonly standing: LicenseStanding | undefined;
  readonly now: Date;
  readonly onOpen: () => void;
}) {
  const customer = license.spec?.customer;
  const expiresAt = toDate(license.spec?.expiresAt);
  const through = expiresAt ? coveredThroughDay(expiresAt) : undefined;
  const graceUntil = toDate(license.spec?.graceUntil);
  // Expired and renewed licenses are history: muted, so what needs action reads first.
  const history = standing?.phase === "disabled";
  // In grace, the deadline that matters is when the customer's server stops:
  // the grace end, not the coverage that already lapsed.
  const inGrace = standing?.timeState === LicenseState.grace && !standing.renewedBy && graceUntil;

  return (
    <div
      role="row"
      className={cn(
        ROW_GRID,
        "stg:relative stg:border-b stg:border-border stg:text-xs stg:text-muted-foreground stg:last:border-b-0",
        "stg:transition-colors stg:hover:bg-accent stg:motion-reduce:transition-none",
      )}
    >
      <span role="cell" className="stg:min-w-0">
        {/* One tab stop per row: the customer's name is the row's button,
            stretched over the whole row so any click opens the license. */}
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "stg:block stg:max-w-full stg:cursor-pointer stg:truncate stg:text-left stg:text-sm stg:font-medium",
            history ? "stg:text-muted-foreground" : "stg:text-foreground",
            "stg:after:absolute stg:after:inset-0",
            "stg:focus-visible:outline-none stg:focus-visible:after:ring-1 stg:focus-visible:after:ring-ring",
          )}
        >
          {customer?.displayName ?? "Unknown customer"}
        </button>
        <span className="stg:block stg:truncate">{customer?.contactEmail}</span>
      </span>
      <span role="cell">{license.spec ? termLabel(license.spec.term) : "—"}</span>
      <span role="cell" className="stg:min-w-0">
        {/* One part per line: at this column's width the parts wrap anyway,
            and a deliberate stack keeps every row's rhythm the same. */}
        {entitlementParts(license.spec?.entitlements).map((part) => (
          <span key={part} className="stg:block stg:truncate">
            {part}
          </span>
        ))}
      </span>
      <span role="cell" className="stg:min-w-0">
        <span className={cn("stg:block stg:text-sm", history ? "stg:text-muted-foreground" : "stg:text-foreground")}>
          {through ?? "Unknown"}
        </span>
        {inGrace ? (
          <span className="stg:block stg:font-medium stg:text-destructive">
            {`Grace ends ${coveredThroughDay(inGrace)}`}
          </span>
        ) : (
          through && <span className="stg:block">{formatDayFromToday(through, now)}</span>
        )}
      </span>
      {/* Above the stretched button so the badge's tooltip stays reachable. */}
      <span role="cell" className="stg:relative stg:z-10 stg:justify-self-start">
        {standing && <StatusBadge phase={standing.phase} label={standing.label} tooltip={standing.reason} />}
      </span>
    </div>
  );
}
