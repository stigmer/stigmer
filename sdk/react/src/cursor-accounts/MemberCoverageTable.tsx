"use client";

import { MoreHorizontal, Pause, Play, Trash2 } from "lucide-react";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";
import { cn } from "@stigmer/theme";
import {
  CursorMemberKeyState,
  type CursorMemberKeyView,
  type CursorTeamMemberView,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import type { CursorMemberSpend } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import { ActionMenu } from "../action-menu/index.js";
import { Button } from "../button/index.js";
import { TruncatedText } from "../internal/truncated-text.js";
import { StateBadge } from "./badges.js";
import { formatPoolPercent, formatSpendMicros } from "./cursor-account-format.js";
import type { CursorAccountCoverage } from "./cursor-account-coverage.js";
import type { useCursorMemberKeyActions } from "./useCursorMemberKeyActions.js";

/**
 * One grid template shared by the header and every row so the columns
 * can never drift apart: Member · First-party % · API % · Included $ ·
 * On-demand $ · Status · actions kebab.
 *
 * The four numeric columns mirror Cursor's own Members page (First-Party
 * Models %, API %, On-Demand $) plus the included-quota dollars, so an
 * operator can read this table and the Cursor dashboard side by side.
 *
 * The column budget is sized for the table's real canvas: both client
 * apps render settings inside `max-w-3xl` (768px), leaving ~720px of
 * content. Fixed tracks total ~25rem, so the flexible member column
 * keeps ~240px — enough to render typical emails whole (stigmer#929: an
 * earlier 8-column layout with a three-button actions column consumed
 * the full width and collapsed the member column to zero, shattering
 * emails one character per line). Key name/label live inside the member
 * cell and row actions inside a kebab menu precisely to defend that
 * budget.
 */
const ROW_GRID =
  "stg:grid stg:grid-cols-[minmax(0,1fr)_4rem_4rem_4.5rem_4.5rem_6rem_2.25rem] stg:items-center stg:gap-2 stg:px-3 stg:py-2";

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
 *    when the account carries a team invite link, the group header
 *    offers one-click copy (one button, not one per row — the link is
 *    account-level and identical for every owner; and always a copy,
 *    never navigation, since opening an invite link would join the
 *    OPERATOR's own Cursor account to the team).
 *
 * The categories render as grouped sections of ONE table — deliberately
 * not tabs. Together they answer a single question ("is this roster
 * healthy?"), so all three counts must be visible at once; groups are
 * team-sized (5–30 rows), never large enough to need pagination-style
 * chrome.
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
    // Narrow-host guard (the ResourceTable idiom): below the grid's
    // legible minimum the table scrolls horizontally instead of letting
    // the flexible member column collapse. The scroll container carries
    // the card chrome; the ARIA table starts inside it so `role="row"`
    // children stay directly owned by the table.
    <div className="stg:overflow-x-auto stg:rounded-lg stg:border stg:border-border stg:bg-card">
      <div role="table" aria-label="Team coverage" className="stg:min-w-[40rem]">
        <div
          role="row"
          className={cn(
            ROW_GRID,
            "stg:border-b stg:border-border stg:text-[11px] stg:font-medium stg:text-muted-foreground",
          )}
        >
          <span role="columnheader">Member</span>
          <span role="columnheader" className="stg:text-right">
            First-party
          </span>
          <span role="columnheader" className="stg:text-right">
            API
          </span>
          <span role="columnheader" className="stg:text-right">
            Included
          </span>
          <span role="columnheader" className="stg:text-right">
            On-demand
          </span>
          <span role="columnheader">Status</span>
          <span role="columnheader">
            <span className="stg:sr-only">Actions</span>
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
                ? "These key owners must join the Cursor team before their usage counts against its quota — copy the invite link, send it out-of-band, then \u201CSync now\u201D reclassifies once they join."
                : "These key owners must join the Cursor team before their usage counts against its quota. Invites are sent from the Cursor dashboard (cursor.com \u2192 Invite Members); paste the team's invite link into the account editor to enable one-click copying here."
            }
            count={coverage.offTeamWithKey.length}
            action={inviteLink !== "" ? <CopyInviteButton inviteLink={inviteLink} /> : undefined}
          >
            {coverage.offTeamWithKey.map((keyView) => (
              <KeyRow
                key={keyView.key?.keyId}
                accountId={accountId}
                keyView={keyView}
                hasRoster
                actions={actions}
                onChanged={onChanged}
              />
            ))}
          </CoverageGroup>
        )}
      </div>
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
  action,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly count: number;
  /** Optional group-level action (e.g. the off-team invite copy). */
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div role="rowgroup" className="stg:border-b stg:border-border stg:last:border-b-0">
      <div role="row" className="stg:bg-muted-subtle stg:px-3 stg:py-1.5">
        <div
          role="cell"
          aria-colspan={7}
          className="stg:flex stg:items-start stg:justify-between stg:gap-2"
        >
          <span className="stg:min-w-0">
            <span className="stg:text-[11px] stg:font-semibold stg:text-foreground">
              {title}
              <span className="stg:ml-1.5 stg:font-normal stg:text-muted-foreground">
                {count}
              </span>
            </span>
            {description && (
              <span className="stg:block stg:text-[11px] stg:text-muted-foreground">
                {description}
              </span>
            )}
          </span>
          {action && <span className="stg:shrink-0">{action}</span>}
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
 * the row's identity and truncates with the overflow-gated house tooltip
 * (never `break-words`: with grid columns under pressure, word-breaking
 * degenerated to one character per line — stigmer#929; the full value
 * stays available to selection, screen readers, and the tooltip). The
 * secondary line carries what each row type actually has: the key
 * name/label on key rows, the roster display name on gap rows
 * (`CursorMemberKeyView` carries no member name to show).
 */
function MemberCell({
  email,
  secondary,
}: {
  readonly email: string;
  readonly secondary?: string;
}) {
  return (
    <span role="cell" className="stg:min-w-0">
      <TruncatedText text={email} className="stg:font-medium stg:text-foreground" />
      {secondary && (
        <TruncatedText
          text={secondary}
          className="stg:text-[11px] stg:text-muted-foreground"
        />
      )}
    </span>
  );
}

/** A key-backed row: categories 1 and 3, plus the pre-sync unclassified state. */
function KeyRow({
  accountId,
  keyView,
  hasRoster,
  actions,
  onChanged,
}: {
  readonly accountId: string;
  readonly keyView: CursorMemberKeyView;
  readonly hasRoster: boolean;
  readonly actions: ReturnType<typeof useCursorMemberKeyActions>;
  readonly onChanged: () => void;
}) {
  const key = keyView.key;
  if (!key) return null;

  const keyMeta = [key.cursorKeyName || "unnamed key", key.label]
    .filter((part) => part !== "")
    .join(" · ");

  return (
    <div role="row" className={cn(ROW_GRID, "stg:border-t stg:border-border-muted stg:text-xs")}>
      <MemberCell email={key.boundEmail} secondary={keyMeta} />
      <SpendCells spend={keyView.spend} />
      <span role="cell" className="stg:flex stg:flex-wrap stg:items-center stg:gap-1">
        {keyView.usageGuardTripped && <StateBadge tone="warn" label="Usage guard" />}
        <KeyStatusBadge keyView={keyView} hasRoster={hasRoster} />
      </span>
      <span role="cell" className="stg:text-right">
        <ActionMenu>
          <ActionMenu.Trigger aria-label={`Actions for ${key.boundEmail}`}>
            <MoreHorizontal className="stg:size-4" />
          </ActionMenu.Trigger>
          <ActionMenu.Content>
            {/* `disabled` guards against a re-fire while a prior key
                mutation is still in flight; outcomes surface via
                actions.error under the table. */}
            <ActionMenu.Item
              icon={key.enabled ? <Pause /> : <Play />}
              disabled={actions.isSubmitting}
              onSelect={() => {
                void actions
                  .setKeyEnabled(accountId, key.keyId, !key.enabled)
                  .then(onChanged, () => {
                    // Surfaced via actions.error.
                  });
              }}
            >
              {key.enabled ? "Disable" : "Enable"}
            </ActionMenu.Item>
            <ActionMenu.Separator />
            <ActionMenu.Item
              icon={<Trash2 />}
              variant="destructive"
              disabled={actions.isSubmitting}
              onSelect={() => {
                void actions
                  .removeKey({ accountId, keyId: key.keyId })
                  .then(onChanged, () => {
                    // Surfaced via actions.error (incl. the live-pin guard's
                    // "disable instead, or force" message).
                  });
              }}
            >
              Remove
            </ActionMenu.Item>
          </ActionMenu.Content>
        </ActionMenu>
      </span>
    </div>
  );
}

/** A coverage-gap row: on the team, no execution key (category 2). */
function GapRow({ memberView }: { readonly memberView: CursorTeamMemberView }) {
  const member = memberView.member;
  if (!member) return null;

  return (
    <div role="row" className={cn(ROW_GRID, "stg:border-t stg:border-border-muted stg:text-xs")}>
      <MemberCell email={member.email} secondary={member.name || undefined} />
      <SpendCells spend={memberView.spend} />
      <span role="cell">
        <StateBadge tone="muted" label="No key" />
      </span>
      {/* No key, no actions — an empty cell keeps every row at the
          header's seven columns. */}
      <span role="cell" />
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
      <span role="cell" className="stg:text-right stg:tabular-nums stg:text-muted-foreground">
        {spend ? formatPoolPercent(spend.autoPercentUsed) : "—"}
      </span>
      <span role="cell" className="stg:text-right stg:tabular-nums stg:text-muted-foreground">
        {spend ? formatPoolPercent(spend.apiPercentUsed) : "—"}
      </span>
      <span role="cell" className="stg:text-right stg:tabular-nums stg:text-muted-foreground">
        {spend ? formatSpendMicros(spend.includedSpendUsdMicros) : "—"}
      </span>
      <span role="cell" className="stg:text-right stg:tabular-nums stg:text-muted-foreground">
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
 * Copies the account-level team invite link, once per group (the link is
 * identical for every off-team owner). Deliberately a copy, never a
 * navigation: a Cursor invite link is a join link, and opening it would
 * join the operator's own Cursor account to the team.
 */
function CopyInviteButton({ inviteLink }: { readonly inviteLink: string }) {
  const { copy, copied } = useCopyFeedback();

  return (
    <Button size="sm" variant="outline" onClick={() => void copy(inviteLink)}>
      {copied ? "Copied" : "Copy invite"}
    </Button>
  );
}
