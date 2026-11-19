"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import type { License } from "@stigmer/apis/ai/stigmer/billing/license/v1/api_pb";
import { ReadOnlyField, ReadOnlyFields } from "../internal/form/ReadOnlyField.js";
import { Section } from "../resource-detail/Section.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { StatusBadge } from "../status/StatusBadge.js";
import { Notice } from "../internal/surface/Notice.js";
import {
  coveredThroughDay,
  formatDay,
  formatDayFromToday,
  formatInstantUtc,
  utcDay,
  termLabel,
  toDate,
} from "./license-format.js";
import type { LicenseStanding } from "./license-standing.js";
import { LicenseTicketPanel } from "./LicenseTicketPanel.js";
import { useLicense } from "./useLicense.js";

/**
 * One issued license: who it is for, what it permits, its dates and the
 * key that signed it, with the ticket panel. The page around it names the
 * license: the customer as the settings page's title, {@link LicenseStandingLine}
 * as its description, and Renew among its acts on the customer's current
 * license, as every settings detail is titled.
 *
 * Everything but the ticket renders from the list entry the parent already
 * holds. The ticket comes from `issued` when the license was just issued
 * (the create answer carries it), and otherwise from one `get` made as the
 * view opens, so the ticket is in memory before the operator clicks Copy.
 */
export function LicenseDetail({
  license,
  issued,
  now,
  className,
}: {
  /** The license as the list holds it (no ticket). */
  readonly license: License;
  /** The license as `create` returned it, when it was just issued. */
  readonly issued?: License;
  readonly now: Date;
  readonly className?: string;
}) {
  const id = license.metadata?.id ?? "";
  const issuedTicket = issued?.status?.ticket;
  const read = useLicense(id, { enabled: !issuedTicket });
  const ticket = issuedTicket ?? read.license?.status?.ticket ?? null;

  const spec = license.spec;
  const customer = spec?.customer;
  const limits = spec?.entitlements?.limits;
  const expiresAt = toDate(spec?.expiresAt);
  const graceUntil = toDate(spec?.graceUntil);
  const issuedAt = toDate(license.status?.issuedAt);
  const issuer = license.status?.audit?.specAudit?.createdBy;
  const graceEnd =
    expiresAt && graceUntil && graceUntil.getTime() > expiresAt.getTime() ? graceUntil : undefined;

  const through = expiresAt ? coveredThroughDay(expiresAt) : undefined;

  return (
    <div className={cn("stg:space-y-4", className)}>
      {issued && (
        <Notice tone="plain" headline="License issued and signed.">
          <p className="stg:m-0">
            Copy the ticket below and send it to {customer?.contactEmail || "the customer"}.
          </p>
        </Notice>
      )}

      <LicenseTicketPanel ticket={ticket} isLoading={!issuedTicket && read.isLoading} error={read.error} />

      <Section title="The license">
        <ReadOnlyFields className="stg:p-4">
        <Row label="Customer">
          <span className="stg:block">{customer?.displayName}</span>
          <span className="stg:block stg:text-muted-foreground">{customer?.contactEmail}</span>
          {customer?.org && (
            <span className="stg:block stg:text-muted-foreground">{`Cloud organization ${customer.org}`}</span>
          )}
        </Row>
        <Row label="Term">{spec ? termLabel(spec.term) : "Unknown"}</Row>
        <Row label="Covered through">
          {expiresAt && through ? (
            <Instant date={expiresAt}>{`${formatDay(through)} (${formatDayFromToday(through, now)})`}</Instant>
          ) : (
            "Unknown"
          )}
        </Row>
        <Row label="Grace">
          {graceEnd ? (
            <Instant date={graceEnd}>{`Through ${formatDay(coveredThroughDay(graceEnd))}`}</Instant>
          ) : (
            "None"
          )}
        </Row>
        <Row label="Limits">
          <span className="stg:block">
            {limits?.maxUsers !== undefined ? `${limits.maxUsers} users` : "Unlimited users"}
          </span>
          <span className="stg:block">
            {limits?.maxOrgs !== undefined
              ? `${limits.maxOrgs} organizations`
              : "Unlimited organizations"}
          </span>
        </Row>
        <Row label="Issued">
          {issuedAt ? <Instant date={issuedAt}>{formatDay(utcDay(issuedAt))}</Instant> : "Unknown"}
          {/* The audit names the account, not only its role-like display name:
              with several operators, "who issued this contract" needs the address.
              An account with no name of its own is called by its email, so
              the address is shown once. */}
          {issuer && (issuer.email || issuer.displayName) && (
            <span className="stg:block stg:text-muted-foreground">
              {issuer.displayName && issuer.email && issuer.displayName !== issuer.email
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
          <Row label="Notes">
            <span className="stg:whitespace-pre-wrap">{spec.notes}</span>
          </Row>
        )}
        </ReadOnlyFields>
      </Section>
    </div>
  );
}

/**
 * "Until when", answered under the customer's name: the license's standing
 * and the day it is covered through, the date sales asks for first.
 */
export function LicenseStandingLine({
  license,
  standing,
  now,
}: {
  readonly license: License;
  readonly standing: LicenseStanding | undefined;
  readonly now: Date;
}) {
  const spec = license.spec;
  const expiresAt = toDate(spec?.expiresAt);
  const through = expiresAt ? coveredThroughDay(expiresAt) : undefined;
  return (
    <span className="stg:inline-flex stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1">
      {standing && <StatusBadge phase={standing.phase} label={standing.label} tooltip={standing.reason} />}
      <span>
        {`${spec ? termLabel(spec.term) : "Unknown term"} · covered through ${through ? formatDay(through) : "an unknown day"}`}
        {through && ` (${formatDayFromToday(through, now)})`}
      </span>
    </span>
  );
}

/** One label and value pair of the license's record. */
function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <ReadOnlyField label={label}>{children}</ReadOnlyField>;
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
