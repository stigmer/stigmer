"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, isPermissionDenied } from "@stigmer/sdk";
import type { CursorAccount } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import type { CursorAccountSummary } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import { Button } from "../button/index.js";
import { StateBadge } from "./badges.js";
import { CursorAccountEditor } from "./CursorAccountEditor.js";
import { CursorAccountsAccessNotice } from "./CursorAccountsAccessNotice.js";
import { deriveCoverage } from "./cursor-account-coverage.js";
import { formatSyncTime } from "./cursor-account-format.js";
import { MemberKeysPanel } from "./MemberKeysPanel.js";
import { useCursorAccounts } from "./useCursorAccounts.js";
import { useCursorAccountView } from "./useCursorAccountView.js";
import { useCursorMemberKeyActions } from "./useCursorMemberKeyActions.js";
import { useDeleteCursorAccount } from "./useDeleteCursorAccount.js";
import { useSyncCursorAccount } from "./useSyncCursorAccount.js";
import { useUpsertCursorAccount } from "./useUpsertCursorAccount.js";

/** Props for {@link CursorAccountsConsole}. */
export interface CursorAccountsConsoleProps {
  /** Additional CSS class names. */
  readonly className?: string;
}

type Flow =
  | { readonly phase: "list" }
  | { readonly phase: "create" }
  | { readonly phase: "detail"; readonly accountId: string; readonly editing: boolean };

/**
 * The platform-operator console for managed Cursor accounts: the Cursor
 * teams (admin keys, member execution keys, org assignments) that back
 * the cursor harness, with roster coverage and per-member usage from
 * the hourly sync.
 *
 * - **List** — every account with routability at a glance (an account
 *   with zero enabled member keys cannot serve executions).
 * - **Detail** — org assignments, "Sync now", and the team-coverage
 *   table: every member and stored key classified into three explicit
 *   categories (on team with key / on team without key / key held but
 *   not on team), each row carrying Cursor's pool-usage percentages
 *   (first-party / API) and cycle spend dollars (included / on-demand).
 *   Off-team rows offer one-click copy of the account's Cursor team
 *   invite link when the operator has configured one.
 *
 * Requires `can_manage_cursor_accounts` on `platform:stigmer` —
 * non-operators see the designed access notice. Key material never
 * reaches this component; the server redacts it on every read.
 *
 * @example
 * ```tsx
 * <CursorAccountsConsole />
 * ```
 */
export function CursorAccountsConsole({ className }: CursorAccountsConsoleProps) {
  const [flow, setFlow] = useState<Flow>({ phase: "list" });
  const list = useCursorAccounts();

  const backToList = useCallback(() => setFlow({ phase: "list" }), []);

  if (list.isLoading) {
    return (
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        <div className="stg:h-4 stg:w-40 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="stg:h-10 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
        ))}
      </div>
    );
  }

  if (list.error) {
    // A non-operator landing here is expected (the route is reachable by
    // URL) — show the designed access notice, not a raw RPC error.
    if (isPermissionDenied(list.error)) {
      return <CursorAccountsAccessNotice className={className} />;
    }
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(list.error)}
      </p>
    );
  }

  if (flow.phase === "create") {
    return (
      <CreatePane
        className={className}
        onSaved={() => {
          list.refetch();
          backToList();
        }}
        onCancel={backToList}
      />
    );
  }

  if (flow.phase === "detail") {
    return (
      <AccountDetail
        className={className}
        accountId={flow.accountId}
        editing={flow.editing}
        onEditingChange={(editing) =>
          setFlow({ phase: "detail", accountId: flow.accountId, editing })
        }
        onDeleted={() => {
          list.refetch();
          backToList();
        }}
        onChanged={list.refetch}
        onBack={backToList}
      />
    );
  }

  const accounts = list.accounts?.accounts ?? [];

  return (
    <div className={cn("stg:space-y-3", className)}>
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
        <h3 className="stg:text-sm stg:font-semibold stg:text-foreground">Cursor accounts</h3>
        <Button size="sm" onClick={() => setFlow({ phase: "create" })}>
          Add account
        </Button>
      </div>

      <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card">
        <div
          aria-hidden="true"
          className="stg:grid stg:grid-cols-[2fr_1fr_1fr_1fr_1fr] stg:gap-2 stg:border-b stg:border-border stg:px-3 stg:py-2 stg:text-[11px] stg:font-medium stg:text-muted-foreground"
        >
          <span>Account</span>
          <span>Orgs</span>
          <span>Status</span>
          <span>Execution keys</span>
          <span className="stg:text-right">Last synced</span>
        </div>
        {accounts.length === 0 ? (
          <p className="stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground">
            No Cursor accounts yet. Add one with its team Admin API key, then
            add member execution keys to make it routable.
          </p>
        ) : (
          <ul role="list" aria-label="Cursor accounts" className="stg:m-0 stg:list-none stg:p-0">
            {accounts.map((summary) => (
              <AccountRow
                key={summary.account?.accountId}
                summary={summary}
                onOpen={() =>
                  setFlow({
                    phase: "detail",
                    accountId: summary.account?.accountId ?? "",
                    editing: false,
                  })
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List row (internal)
// ---------------------------------------------------------------------------

function AccountRow({
  summary,
  onOpen,
}: {
  readonly summary: CursorAccountSummary;
  readonly onOpen: () => void;
}) {
  const account = summary.account;
  if (!account) return null;

  return (
    <li className="stg:border-b stg:border-border stg:last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "stg:grid stg:w-full stg:grid-cols-[2fr_1fr_1fr_1fr_1fr] stg:items-center stg:gap-2 stg:px-3 stg:py-2 stg:text-left stg:text-xs",
          "stg:transition-colors stg:hover:bg-accent",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
        )}
      >
        <span className="stg:min-w-0">
          <span className="stg:block stg:truncate stg:font-medium stg:text-foreground">
            {account.displayName}
          </span>
          {/* Account class is DERIVED from org_ids (DD-008): no org
              assignment means the account belongs to the shared pool. */}
          {account.orgIds.length === 0 && (
            <span className="stg:block stg:text-[11px] stg:text-muted-foreground">
              shared pool
            </span>
          )}
        </span>
        <span className="stg:text-muted-foreground">
          {account.orgIds.length > 0 ? account.orgIds.length : "—"}
        </span>
        <span>
          <StateBadge
            tone={account.enabled ? "ok" : "muted"}
            label={account.enabled ? "Enabled" : "Disabled"}
          />
        </span>
        <span>
          {summary.enabledKeyCount > 0 ? (
            <span className="stg:text-muted-foreground">{summary.enabledKeyCount}</span>
          ) : (
            <StateBadge tone="warn" label="Not routable" />
          )}
        </span>
        <span className="stg:text-right stg:text-muted-foreground">
          {formatSyncTime(summary.lastSyncedAt)}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Create pane (internal)
// ---------------------------------------------------------------------------

function CreatePane({
  className,
  onSaved,
  onCancel,
}: {
  readonly className?: string;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}) {
  const { upsert, isSubmitting, error } = useUpsertCursorAccount();

  return (
    <div className={className}>
      <CursorAccountEditor
        initial={null}
        isSubmitting={isSubmitting}
        submitError={error}
        onSubmit={(account) => {
          void upsert(account).then(onSaved, () => {
            // Surfaced via submitError.
          });
        }}
        onCancel={onCancel}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail pane (internal)
// ---------------------------------------------------------------------------

function AccountDetail({
  className,
  accountId,
  editing,
  onEditingChange,
  onDeleted,
  onChanged,
  onBack,
}: {
  readonly className?: string;
  readonly accountId: string;
  readonly editing: boolean;
  readonly onEditingChange: (editing: boolean) => void;
  readonly onDeleted: () => void;
  readonly onChanged: () => void;
  readonly onBack: () => void;
}) {
  const detail = useCursorAccountView(accountId);
  const { upsert, isSubmitting: isSaving, error: saveError, clearError: clearSaveError } =
    useUpsertCursorAccount();
  const { remove, isSubmitting: isDeleting, error: deleteError } =
    useDeleteCursorAccount();
  const { sync, isSyncing, error: syncError } = useSyncCursorAccount();
  const keyActions = useCursorMemberKeyActions();

  const refreshAll = useCallback(() => {
    detail.refetch();
    onChanged();
  }, [detail.refetch, onChanged]);

  // After a bulk import, run the roster sync automatically so key badges
  // (Active / Owner unknown / Owner left team) are current without a
  // manual "Sync now". Sync failure still refreshes — the keys ARE added
  // — and is surfaced via syncError.
  const syncAfterImport = useCallback(() => {
    void sync(accountId).then(refreshAll, refreshAll);
  }, [sync, accountId, refreshAll]);

  if (detail.isLoading) {
    return (
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        <div className="stg:h-4 stg:w-40 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
        <div className="stg:h-24 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
      </div>
    );
  }

  if (detail.error || !detail.view?.account) {
    return (
      <div className={cn("stg:space-y-2", className)}>
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {detail.error ? getUserMessage(detail.error) : "Account not found."}
        </p>
        <Button size="sm" variant="outline" onClick={onBack}>
          Back to accounts
        </Button>
      </div>
    );
  }

  const view = detail.view;
  const account = view.account as CursorAccount;
  // Derived once here: the panel's table consumes the groups, the header
  // line the member counts (active roster = covered + uncovered members —
  // server-computed facts only, no role-string parsing in the client).
  // The covered count is exactly one row per member because the server
  // rejects a second key for an already-bound email, so the removed-seat
  // count is plain list arithmetic: roster entries minus active members.
  // It answers "where did my N members go?" when Cursor marks departed
  // seats role:"removed" in place instead of dropping them.
  const coverage = deriveCoverage(view);
  const activeMemberCount =
    coverage.onTeamWithKey.length + coverage.onTeamWithoutKey.length;
  const removedSeatCount =
    (view.snapshot?.members.length ?? 0) - activeMemberCount;

  if (editing) {
    return (
      <div className={className}>
        <CursorAccountEditor
          initial={account}
          isSubmitting={isSaving}
          submitError={saveError}
          onSubmit={(edited) => {
            void upsert(edited).then(() => {
              refreshAll();
              onEditingChange(false);
            }, () => {
              // Surfaced via submitError.
            });
          }}
          onCancel={() => {
            clearSaveError();
            onEditingChange(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className={cn("stg:space-y-4", className)}>
      <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-2">
        <div>
          <h3 className="stg:text-sm stg:font-semibold stg:text-foreground">
            {account.displayName}
          </h3>
          <p className="stg:text-[11px] stg:text-muted-foreground">
            {account.orgIds.length > 0
              ? `Dedicated to ${account.orgIds.length} org(s): ${account.orgIds.join(", ")}`
              : "Shared pool — serves every org with no dedicated account"}
            {" · "}
            {account.enabled ? "enabled" : "disabled"}
            {account.onDemandUsageDisabled
              ? " · on-demand usage off (usage guard active)"
              : ""}
            {" · synced "}
            {formatSyncTime(view.snapshot?.syncedAt)}
            {coverage.hasRoster
              ? ` · ${activeMemberCount} ${activeMemberCount === 1 ? "member" : "members"}`
              : ""}
            {coverage.hasRoster && removedSeatCount > 0
              ? ` · ${removedSeatCount} removed ${removedSeatCount === 1 ? "seat" : "seats"}`
              : ""}
          </p>
        </div>
        <div className="stg:flex stg:gap-2">
          <Button size="sm" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isSyncing}
            onClick={() => {
              void sync(accountId).then(refreshAll, () => {
                // Surfaced via syncError.
              });
            }}
          >
            {isSyncing ? "Syncing…" : "Sync now"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onEditingChange(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={isDeleting}
            onClick={() => {
              void remove({ accountId }).then(onDeleted, () => {
                // Surfaced via deleteError (incl. the live-pin guard's
                // "disable instead, or force" message).
              });
            }}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>

      {syncError && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(syncError)}
        </p>
      )}
      {deleteError && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(deleteError)}
        </p>
      )}
      {view.snapshot?.syncError && (
        <p className="stg:text-xs stg:text-muted-foreground" role="status">
          Last sync was partial: {view.snapshot.syncError}
        </p>
      )}

      <MemberKeysPanel
        accountId={accountId}
        view={view}
        coverage={coverage}
        actions={keyActions}
        onChanged={refreshAll}
        onImported={syncAfterImport}
      />
    </div>
  );
}

