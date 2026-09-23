"use client";

import type { ReactNode } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { cn } from "@stigmer/theme";
import type { License } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import { Button } from "../button/index.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { StatusBadge } from "../resource-workbench/components/StatusBadge.js";
import {
  FEATURE_LABELS,
  coveredThroughDay,
  formatDayFromToday,
  formatInstantUtc,
  termLabel,
  toDate,
  type GrantableFeature,
} from "./license-format.js";
import type { LicenseStanding } from "./license-standing.js";
import { LicenseTicketPanel } from "./LicenseTicketPanel.js";
import { useLicense } from "./useLicense.js";

const ICON = "stg:size-3.5";

/**
 * One issued license: who it is for, what it permits, its dates and the
 * key that signed it, with the ticket panel and, on the customer's current
 * license, Renew.
 *
 * Everything but the ticket renders from the list entry the parent already
 * holds. The ticket comes from `issued` when the license was just issued
 * (the create answer carries it), and otherwise from one `get` made as the
 * view opens, so the ticket is in memory before the operator clicks Copy.
 */
export function LicenseDetail({
  license,
  issued,
  standing,
  now,
  onBack,
  onRenew,
  className,
}: {
  /** The license as the list holds it (no ticket). */
  readonly license: License;
  /** The license as `create` returned it, when it was just issued. */
  readonly issued?: License;
  readonly standing: LicenseStanding | undefined;
  readonly now: Date;
  readonly onBack: () => void;
  /** Present only when this is the customer's current license. */
  readonly onRenew?: () => void;
  readonly className?: string;
}) {
  const id = license.metadata?.id ?? "";
  const issuedTicket = issued?.status?.ticket;
  const read = useLicense(id, { enabled: !issuedTicket });
  const ticket = issuedTicket ?? read.license?.status?.ticket ?? null;

  const spec = license.spec;
  const customer = spec?.customer;
  const limits = spec?.entitlements?.limits;
  const features = (spec?.entitlements?.features ?? []).filter(
    (f): f is GrantableFeature => f in FEATURE_LABELS,
  );
  const expiresAt = toDate(spec?.expiresAt);
  const graceUntil = toDate(spec?.graceUntil);
  const issuedAt = toDate(license.status?.issuedAt);
  const issuer = license.status?.audit?.specAudit?.createdBy;
  const graceEnd =
    expiresAt && graceUntil && graceUntil.getTime() > expiresAt.getTime() ? graceUntil : undefined;

  const through = expiresAt ? coveredThroughDay(expiresAt) : undefined;

  return (
    <div className={cn("stg:space-y-4", className)}>
      <div className="stg:space-y-2">
        <Button variant="ghost" size="xs" icon={<ArrowLeft className={ICON} aria-hidden="true" />} onClick={onBack}>
          Licenses
        </Button>
        <div className="stg:flex stg:flex-wrap stg:items-start stg:justify-between stg:gap-2">
          <div className="stg:min-w-0">
            <h3 className="stg:m-0 stg:truncate stg:text-base stg:font-semibold stg:text-foreground">
              {customer?.displayName ?? "Unknown customer"}
            </h3>
            {/* "Until when" answered beside the name: the date sales asks for first. */}
            <p className="stg:m-0 stg:mt-1 stg:flex stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1 stg:text-sm stg:text-muted-foreground">
              {standing && (
                <StatusBadge phase={standing.phase} label={standing.label} tooltip={standing.reason} />
              )}
              <span>
                {`${spec ? termLabel(spec.term) : "Unknown term"} · covered through ${through ?? "an unknown day"}`}
                {through && ` (${formatDayFromToday(through, now)})`}
              </span>
            </p>
          </div>
          {onRenew && (
            <Button variant="outline" icon={<RefreshCw className={ICON} aria-hidden="true" />} onClick={onRenew}>
              Renew
            </Button>
          )}
        </div>
      </div>

      {issued && (
        <p
          className="stg:m-0 stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-3 stg:py-2 stg:text-sm stg:text-foreground"
          role="status"
        >
          License issued and signed. Copy the ticket below and send it to{" "}
          {customer?.contactEmail || "the customer"}.
        </p>
      )}

      <LicenseTicketPanel ticket={ticket} isLoading={!issuedTicket && read.isLoading} error={read.error} />

      <dl className="stg:m-0 stg:grid stg:grid-cols-1 stg:gap-x-6 stg:gap-y-4 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4 stg:sm:grid-cols-2">
        <Row label="Customer">
          <span className="stg:block">{customer?.displayName}</span>
          <span className="stg:block stg:text-muted-foreground">{customer?.contactEmail}</span>
          {customer?.organization && (
            <span className="stg:block stg:text-muted-foreground">{`Cloud organization ${customer.organization}`}</span>
          )}
        </Row>
        <Row label="Term">{spec ? termLabel(spec.term) : "Unknown"}</Row>
        <Row label="Covered through">
          {expiresAt && through ? (
            <Instant date={expiresAt}>{`${through} (${formatDayFromToday(through, now)})`}</Instant>
          ) : (
            "Unknown"
          )}
        </Row>
        <Row label="Grace">
          {graceEnd ? (
            <Instant date={graceEnd}>{`Through ${coveredThroughDay(graceEnd)}`}</Instant>
          ) : (
            "None"
          )}
        </Row>
        <Row label="Limits">
          <span className="stg:block">
            {limits?.maxUsers !== undefined ? `${limits.maxUsers} users` : "Unlimited users"}
          </span>
          <span className="stg:block">
            {limits?.maxOrganizations !== undefined
              ? `${limits.maxOrganizations} organizations`
              : "Unlimited organizations"}
          </span>
        </Row>
        <Row label="Features">
          {features.length === 0
            ? "None"
            : features.map((f) => (
                <span key={f} className="stg:block">
                  {FEATURE_LABELS[f].label}
                </span>
              ))}
        </Row>
        <Row label="Issued">
          {issuedAt ? <Instant date={issuedAt}>{formatInstantUtc(issuedAt)}</Instant> : "Unknown"}
          {/* The audit names the account, not only its role-like display name:
              with several operators, "who issued this contract" needs the address. */}
          {issuer && (issuer.email || issuer.displayName) && (
            <span className="stg:block stg:text-muted-foreground">
              {issuer.displayName && issuer.email
                ? `by ${issuer.displayName} (${issuer.email})`
                : `by ${issuer.displayName || issuer.email}`}
            </span>
          )}
        </Row>
        <Row label="Signing key">
          <span className="stg:font-mono">{license.status?.keyId || "Unknown"}</span>
        </Row>
        {/* Identifiers are secondary: they live here for support and audits,
            never as the page's second line. */}
        <Row label="License">
          <span className="stg:block">{license.metadata?.name}</span>
          <span className="stg:block stg:font-mono stg:text-muted-foreground">{id}</span>
        </Row>
        {spec?.notes && (
          <Row label="Notes" wide>
            <span className="stg:whitespace-pre-wrap">{spec.notes}</span>
          </Row>
        )}
      </dl>
    </div>
  );
}

function Row({
  label,
  wide,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={cn("stg:min-w-0", wide && "stg:sm:col-span-2")}>
      <dt className="stg:text-xs stg:text-muted-foreground">{label}</dt>
      <dd className="stg:m-0 stg:mt-0.5 stg:break-words stg:text-sm stg:text-foreground">{children}</dd>
    </div>
  );
}

/** A day that carries its exact UTC instant in a tooltip. */
function Instant({ date, children }: { readonly date: Date; readonly children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="stg:inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent side="top">{formatInstantUtc(date)}</TooltipContent>
    </Tooltip>
  );
}
