"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import {
  CursorMemberKeyState,
  type CursorMemberKeyView,
  type CursorTeamMemberView,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import type { CursorMemberSpend } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import { Button } from "../button/index.js";
import { StateBadge } from "./badges.js";
import { formatPoolPercent, formatSpendMicros } from "./cursor-account-format.js";
import type { CursorAccountCoverage } from "./cursor-account-coverage.js";
import type { useCursorMemberKeyActions } from "./useCursorMemberKeyActions.js";

/**
 * One grid template shared by the header and every row so the columns
 * can never drift apart: Member · Key · First-party % · API % ·
 * Included $ · On-demand $ · Status · Actions.
 *
 * The four numeric columns mirror Cursor's own Members page (First-Party
 * Models %, API %, On-Demand $) plus the included-quota dollars, so an
 * operator can read this table and the Cursor dashboard side by side.
 *
 * Member gets the largest flexible share: the email is the row's
 * identity, so it wraps rather than truncates when space runs out (see
 * MemberCell) while the key name stays truncate-with-tooltip.
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_4.5rem_4.5rem_4.5rem_4.5rem_minmax(6rem,auto)_minmax(10rem,auto)] items-center gap-2 px-3 py-2";

/**
 * The roster-coverage table: every member and every stored execution key
 * of one Cursor account, classified into three explicit categories
 * (server-computed — this component only renders):
 *
 * 1. **On the team, key held** — the account's routable capacity.
 * 2. **On the team, no key** — the coverage gap; their spend columns
 *    help the operator prioritize whose key to import.
 * 3. **Key held, not on the team** — imported keys whose owner left the
 *    team or never joined it. Resolved by a Cursor-dashboard invite:
 *    when the account carries a team invite link, each row offers
 *    one-click copy (never navigation — opening an invite link would
 *    join the OPERATOR's own Cursor account to the team).
 *
 * Before the first sync there is no roster to classify against, so keys
 * render unclassified with a "sync now" notice instead of being falsely
 * reported as off-team.
 */
export function MemberCoverageTable({
  accountId,
  coverage,
  inviteLink,
  actions,
  onChanged,
}: {
  readonly accountId: string;
  readonly coverage: CursorAccountCoverage;
  /** The account-level Cursor team invite link; empty when not configured. */
  readonly inviteLink: string;
  readonly actions: ReturnType<typeof useCursorMemberKeyActions>;
  readonly onChanged: () => void;
}) {
  return (
    <div
      role="table"
      aria-label="Team coverage"
      className="rounded-lg border border-border bg-card"
    >
      <div
        role="row"
        className={cn(
          ROW_GRID,
          "border-b border-border text-[11px] font-medium text-muted-foreground",
        )}
      >
        <span role="columnheader">Member</span>
        <span role="columnheader">Key</span>
        <span role="columnheader" className="text-right">
          First-party
        </span>
        <span role="columnheader" className="text-right">
          API
        </span>
        <span role="columnheader" className="text-right">
          Included
        </span>
        <span role="columnheader" className="text-right">
          On-demand
        </span>
        <span role="columnheader">Status</span>
        <span role="columnheader" className="text-right">
          Actions
        </span>
      </div>

      {!coverage.hasRoster && (
        <CoverageGroup
          title="Execution keys — not yet classified"
          description='No roster sync has run for this account. Run "Sync now" to load the team roster and classify these keys.'
          count={coverage.unclassified.length}
        >
          {coverage.unclassified.map((keyView) => (
            <KeyRow
              key={keyView.key?.keyId}
              accountId={accountId}
              keyView={keyView}
              hasRoster={false}
              inviteLink=""
              actions={actions}
              onChanged={onChanged}
            />
          ))}
        </CoverageGroup>
      )}

      {coverage.onTeamWithKey.length > 0 && (
        <CoverageGroup
          title="On the team — key held"
          count={coverage.onTeamWithKey.length}
        >
          {coverage.onTeamWithKey.map((keyView) => (
            <KeyRow
              key={keyView.key?.keyId}
              accountId={accountId}
              keyView={keyView}
              hasRoster
              inviteLink=""
              actions={actions}
              onChanged={onChanged}
            />
          ))}
        </CoverageGroup>
      )}

      {/* Rendered whenever a roster exists — an empty gap is an answer
          ("fully covered"), not an absence. Hiding the group made a
          healthy roster indistinguishable from a broken sync. */}
      {coverage.hasRoster && (
        <CoverageGroup
          title="On the team — no execution key"
          description={
            coverage.onTeamWithoutKey.length > 0
              ? "Sessions can never run under these members' identity or included quota. Add their user-scoped keys below to close the gap."
              : "Every active roster member holds an execution key — the roster is fully covered."
          }
          count={coverage.onTeamWithoutKey.length}
        >
          {coverage.onTeamWithoutKey.map((memberView) => (
            <GapRow key={memberView.member?.email} memberView={memberView} />
          ))}
        </CoverageGroup>
      )}

      {coverage.offTeamWithKey.length > 0 && (
        <CoverageGroup
          title="Key held — not on the team"
          description={
            inviteLink !== ""
              ? "These key owners must join the Cursor team before their usage counts against its quota. Copy the invite link, send it to them out-of-band, then \u201CSync now\u201D reclassifies once they join."
              : "These key owners must join the Cursor team before their usage counts against its quota. Invites are sent from the Cursor dashboard (cursor.com \u2192 Invite Members); paste the team's invite link into the account editor to enable one-click copying here."
          }
          count={coverage.offTeamWithKey.length}
        >
          {coverage.offTeamWithKey.map((keyView) => (
            <KeyRow
              key={keyView.key?.keyId}
              accountId={accountId}
              keyView={keyView}
              hasRoster
              inviteLink={inviteLink}
              actions={actions}
              onChanged={onChanged}
            />
          ))}
        </CoverageGroup>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group section (internal)
// ---------------------------------------------------------------------------

function CoverageGroup({
  title,
  description,
  count,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly count: number;
  readonly children: React.ReactNode;
}) {
  return (
    <div role="rowgroup" className="border-b border-border last:border-b-0">
      <div role="row" className="bg-muted-subtle px-3 py-1.5">
        <div role="cell" aria-colspan={8}>
          <span className="text-[11px] font-semibold text-foreground">
            {title}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {count}
            </span>
          </span>
          {description && (
            <span className="block text-[11px] text-muted-foreground">
              {description}
            </span>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows (internal)
// ---------------------------------------------------------------------------

/**
 * The member-identity cell shared by key rows and gap rows. The email is
 * the row's identity, so it must be fully readable: it wraps onto more
 * lines when the column is narrow (emails are unbroken strings, so they
 * need explicit word-breaking) with a hover tooltip as backup, unlike
 * the other text cells which truncate. The secondary name line stays
 * truncated — it is display sugar, not identity.
 */
function MemberCell({
  email,
  name,
}: {
  readonly email: string;
  readonly name?: string;
}) {
  return (
    <span role="cell" className="min-w-0">
      <span className="block break-words font-medium text-foreground" title={email}>
        {email}
      </span>
      {name && (
        <span className="block truncate text-[11px] text-muted-foreground">
          {name}
        </span>
      )}
    </span>
  );
}

/** A key-backed row: categories 1 and 3, plus the pre-sync unclassified state. */
function KeyRow({
  accountId,
  keyView,
  hasRoster,
  inviteLink,
  actions,
  onChanged,
}: {
  readonly accountId: string;
  readonly keyView: CursorMemberKeyView;
  readonly hasRoster: boolean;
  readonly inviteLink: string;
  readonly actions: ReturnType<typeof useCursorMemberKeyActions>;
  readonly onChanged: () => void;
}) {
  const key = keyView.key;
  if (!key) return null;

  return (
    <div role="row" className={cn(ROW_GRID, "border-t border-border-muted text-xs")}>
      <MemberCell email={key.boundEmail} />
      <span role="cell" className="min-w-0">
        <span
          className="block truncate text-muted-foreground"
          title={key.cursorKeyName || undefined}
        >
          {key.cursorKeyName || "unnamed key"}
        </span>
        {key.label && (
          <span className="block truncate text-[11px] text-muted-foreground" title={key.label}>
            {key.label}
          </span>
        )}
      </span>
      <SpendCells spend={keyView.spend} />
      <span role="cell" className="flex flex-wrap items-center gap-1">
        {keyView.usageGuardTripped && <StateBadge tone="warn" label="Usage guard" />}
        <KeyStatusBadge keyView={keyView} hasRoster={hasRoster} />
      </span>
      <span role="cell" className="flex items-center justify-end gap-2">
        {inviteLink !== "" && <CopyInviteButton inviteLink={inviteLink} />}
        <Button
          size="sm"
          variant="outline"
          disabled={actions.isSubmitting}
          onClick={() => {
            void actions
              .setKeyEnabled(accountId, key.keyId, !key.enabled)
              .then(onChanged, () => {
                // Surfaced via actions.error.
              });
          }}
        >
          {key.enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={actions.isSubmitting}
          onClick={() => {
            void actions
              .removeKey({ accountId, keyId: key.keyId })
              .then(onChanged, () => {
                // Surfaced via actions.error (incl. the live-pin guard's
                // "disable instead, or force" message).
              });
          }}
        >
          Remove
        </Button>
      </span>
    </div>
  );
}

/** A coverage-gap row: on the team, no execution key (category 2). */
function GapRow({ memberView }: { readonly memberView: CursorTeamMemberView }) {
  const member = memberView.member;
  if (!member) return null;

  return (
    <div role="row" className={cn(ROW_GRID, "border-t border-border-muted text-xs")}>
      <MemberCell email={member.email} name={member.name} />
      <span role="cell" className="text-muted-foreground">
        —
      </span>
      <SpendCells spend={memberView.spend} />
      <span role="cell">
        <StateBadge tone="muted" label="No key" />
      </span>
      <span role="cell" className="text-right text-muted-foreground">
        —
      </span>
    </div>
  );
}

/**
 * The four numeric cells — first-party pool %, API pool %, included $,
 * on-demand $ — shared by key rows and gap rows. Each maps 1:1 onto a
 * stored `CursorMemberSpend` field; the blended `totalPercentUsed` is
 * deliberately not rendered (it maps to nothing on Cursor's dashboard
 * and reports a flat 100 for removed members). Only a member with no
 * spend row at all renders em-dashes — Cursor omits the row itself for
 * some team shapes.
 */
function SpendCells({ spend }: { readonly spend: CursorMemberSpend | undefined }) {
  return (
    <>
      <span role="cell" className="text-right tabular-nums text-muted-foreground">
        {spend ? formatPoolPercent(spend.autoPercentUsed) : "—"}
      </span>
      <span role="cell" className="text-right tabular-nums text-muted-foreground">
        {spend ? formatPoolPercent(spend.apiPercentUsed) : "—"}
      </span>
      <span role="cell" className="text-right tabular-nums text-muted-foreground">
        {spend ? formatSpendMicros(spend.includedSpendUsdMicros) : "—"}
      </span>
      <span role="cell" className="text-right tabular-nums text-muted-foreground">
        {spend ? formatSpendMicros(spend.overageSpendUsdMicros) : "—"}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Status badge (internal)
// ---------------------------------------------------------------------------

/**
 * Membership + enablement status of one key row. With a roster present,
 * "owner unknown" means the owner never appeared in it — "Not on team";
 * without one it is merely missing data — "Awaiting sync".
 */
function KeyStatusBadge({
  keyView,
  hasRoster,
}: {
  readonly keyView: CursorMemberKeyView;
  readonly hasRoster: boolean;
}) {
  if (!hasRoster) {
    return <StateBadge tone="muted" label="Awaiting sync" />;
  }
  if (keyView.state === CursorMemberKeyState.member_key_owner_removed) {
    return <StateBadge tone="warn" label="Left team" />;
  }
  if (keyView.state === CursorMemberKeyState.member_key_owner_unknown) {
    return <StateBadge tone="muted" label="Not on team" />;
  }
  return keyView.key?.enabled ? (
    <StateBadge tone="ok" label="Active" />
  ) : (
    <StateBadge tone="muted" label="Disabled" />
  );
}

// ---------------------------------------------------------------------------
// Copy-invite action (internal)
// ---------------------------------------------------------------------------

/**
 * Copies the account-level team invite link. Deliberately a copy, never
 * a navigation: a Cursor invite link is a join link, and opening it
 * would join the operator's own Cursor account to the team.
 */
function CopyInviteButton({ inviteLink }: { readonly inviteLink: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions, non-secure context) — the
      // section description still points at the Cursor dashboard.
    }
  }, [inviteLink]);

  return (
    <Button size="sm" variant="outline" onClick={() => void handleCopy()}>
      {copied ? "Copied" : "Copy invite"}
    </Button>
  );
}
