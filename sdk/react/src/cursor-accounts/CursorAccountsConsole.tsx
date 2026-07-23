"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, isPermissionDenied } from "@stigmer/sdk";
import type { CursorAccount } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import {
  CursorMemberKeyState,
  type CursorAccountSummary,
  type CursorMemberKeyView,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import { Button } from "../button/index.js";
import { INPUT_CLASSES } from "../billing/form-primitives.js";
import { toError } from "../internal/toError.js";
import { CursorAccountEditor } from "./CursorAccountEditor.js";
import { CursorAccountsAccessNotice } from "./CursorAccountsAccessNotice.js";
import { formatPoolPercent, formatSpendMicros, formatSyncTime } from "./cursor-account-format.js";
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
 * the cursor harness, with roster coverage and per-member cycle spend
 * from the hourly sync.
 *
 * - **List** — every account with routability at a glance (an account
 *   with zero enabled member keys cannot serve executions).
 * - **Detail** — org assignments, the member-key panel (add / disable /
 *   remove, each key joined with its owner's roster state and spend),
 *   coverage gaps (active members without keys), and "Sync now".
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
      <div className={cn("space-y-2", className)} aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-muted-subtle" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-muted-subtle" />
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
      <p className={cn("text-destructive text-xs", className)} role="alert">
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
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Cursor accounts</h3>
        <Button size="sm" onClick={() => setFlow({ phase: "create" })}>
          Add account
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div
          aria-hidden="true"
          className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 border-b border-border px-3 py-2 text-[11px] font-medium text-muted-foreground"
        >
          <span>Account</span>
          <span>Orgs</span>
          <span>Status</span>
          <span>Execution keys</span>
          <span className="text-right">Last synced</span>
        </div>
        {accounts.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No Cursor accounts yet. Add one with its team Admin API key, then
            add member execution keys to make it routable.
          </p>
        ) : (
          <ul role="list" aria-label="Cursor accounts" className="m-0 list-none p-0">
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
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "grid w-full grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-2 px-3 py-2 text-left text-xs",
          "transition-colors hover:bg-accent",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground">
            {account.displayName}
          </span>
          {account.isPlatformDefault && (
            <span className="block text-[11px] text-muted-foreground">
              platform default
            </span>
          )}
        </span>
        <span className="text-muted-foreground">
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
            <span className="text-muted-foreground">{summary.enabledKeyCount}</span>
          ) : (
            <StateBadge tone="warn" label="Not routable" />
          )}
        </span>
        <span className="text-right text-muted-foreground">
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
      <div className={cn("space-y-2", className)} aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-muted-subtle" />
        <div className="h-24 animate-pulse rounded-lg bg-muted-subtle" />
      </div>
    );
  }

  if (detail.error || !detail.view?.account) {
    return (
      <div className={cn("space-y-2", className)}>
        <p className="text-destructive text-xs" role="alert">
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
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {account.displayName}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {account.orgIds.length > 0
              ? `Serves ${account.orgIds.length} org(s): ${account.orgIds.join(", ")}`
              : account.isPlatformDefault
                ? "Platform default — serves all unassigned orgs"
                : "No org assignments"}
            {" · "}
            {account.enabled ? "enabled" : "disabled"}
            {account.onDemandUsageDisabled
              ? " · on-demand usage off (usage guard active)"
              : ""}
            {" · synced "}
            {formatSyncTime(view.snapshot?.syncedAt)}
          </p>
        </div>
        <div className="flex gap-2">
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
        <p className="text-destructive text-xs" role="alert">
          {getUserMessage(syncError)}
        </p>
      )}
      {deleteError && (
        <p className="text-destructive text-xs" role="alert">
          {getUserMessage(deleteError)}
        </p>
      )}
      {view.snapshot?.syncError && (
        <p className="text-xs text-muted-foreground" role="status">
          Last sync was partial: {view.snapshot.syncError}
        </p>
      )}

      <MemberKeysPanel
        accountId={accountId}
        keyViews={view.keyViews}
        actions={keyActions}
        onChanged={refreshAll}
        onImported={syncAfterImport}
      />

      {view.membersWithoutKeys.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-xs font-semibold text-foreground">
            Members without execution keys
          </h4>
          <p className="text-[11px] text-muted-foreground">
            Active team members Stigmer holds no key for — sessions can never
            run under their identity or included quota.
          </p>
          <ul role="list" className="m-0 list-none space-y-0.5 p-0 text-xs text-muted-foreground">
            {view.membersWithoutKeys.map((member) => (
              <li key={member.email}>
                {member.name || member.email} · {member.email}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Member keys panel (internal)
// ---------------------------------------------------------------------------

/** One line's outcome from a bulk key import. */
interface ImportLineResult {
  /** Masked identification of the key (never the full material). */
  readonly keyPreview: string;
  readonly ok: boolean;
  /** Bound email on success; the server/Cursor error on failure. */
  readonly message: string;
}

/** Parse bulk-import text: one key per line, trimmed, deduped. */
function parseImportKeys(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== ""))];
}

function maskKey(key: string, index: number): string {
  return key.length >= 8 ? `key ${index + 1} (…${key.slice(-4)})` : `key ${index + 1}`;
}

function MemberKeysPanel({
  accountId,
  keyViews,
  actions,
  onChanged,
  onImported,
}: {
  readonly accountId: string;
  readonly keyViews: readonly CursorMemberKeyView[];
  readonly actions: ReturnType<typeof useCursorMemberKeyActions>;
  readonly onChanged: () => void;
  /** Called after a bulk import added at least one key (triggers sync). */
  readonly onImported: () => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<
    { readonly done: number; readonly total: number } | null
  >(null);
  const [importResults, setImportResults] = useState<readonly ImportLineResult[] | null>(
    null,
  );

  const submitNewKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (newKey.trim() === "" || actions.isSubmitting) return;
    void actions
      .addKey({ accountId, apiKey: newKey.trim(), label: newLabel.trim() || undefined })
      .then(() => {
        setNewKey("");
        setNewLabel("");
        onChanged();
      }, () => {
        // Surfaced via actions.error (incl. Cursor's own key-class 401 text).
      });
  };

  const importKeyCount = parseImportKeys(importText).length;

  const submitImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const keys = parseImportKeys(importText);
    if (keys.length === 0 || isImporting) return;

    setIsImporting(true);
    setImportResults(null);

    // Sequential on purpose: each key is validated live against Cursor's
    // /v1/me, and per-key errors (wrong key class, revoked, duplicate)
    // must be attributable to their line.
    const knownKeyIds = new Set(
      keyViews.map((kv) => kv.key?.keyId).filter((id): id is string => !!id),
    );
    const results: ImportLineResult[] = [];
    const failedKeys: string[] = [];
    for (const [i, key] of keys.entries()) {
      setImportProgress({ done: i, total: keys.length });
      try {
        const account = await actions.addKey({ accountId, apiKey: key });
        const addedKey = account.memberKeys.find((mk) => !knownKeyIds.has(mk.keyId));
        if (addedKey) knownKeyIds.add(addedKey.keyId);
        results.push({
          keyPreview: maskKey(key, i),
          ok: true,
          message: addedKey?.boundEmail
            ? `added — bound to ${addedKey.boundEmail}`
            : "added",
        });
      } catch (err) {
        actions.clearError();
        failedKeys.push(key);
        results.push({
          keyPreview: maskKey(key, i),
          ok: false,
          message: getUserMessage(toError(err)),
        });
      }
    }

    setImportProgress(null);
    setImportResults(results);
    // Failed lines stay in the box so the operator can fix and retry.
    setImportText(failedKeys.join("\n"));
    setIsImporting(false);
    if (failedKeys.length < keys.length) onImported();
  };

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold text-foreground">Member execution keys</h4>

      {keyViews.length === 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          No execution keys — this account is <strong>not routable</strong>.
          Add a member's user-scoped API key below.
        </p>
      ) : (
        <ul role="list" aria-label="Member keys" className="m-0 list-none space-y-1 p-0">
          {keyViews.map((keyView) => (
            <MemberKeyRow
              key={keyView.key?.keyId}
              accountId={accountId}
              keyView={keyView}
              actions={actions}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}

      {actions.error && (
        <p className="text-destructive text-xs" role="alert">
          {getUserMessage(actions.error)}
        </p>
      )}

      <form className="flex flex-wrap items-end gap-2" onSubmit={submitNewKey}>
        <label className="block min-w-56 flex-1 space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            User-scoped API key
          </span>
          <input
            className={INPUT_CLASSES}
            type="password"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="the member's personal Cursor API key"
            disabled={actions.isSubmitting}
            autoComplete="off"
          />
        </label>
        <label className="block min-w-40 space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            Label (optional)
          </span>
          <input
            className={INPUT_CLASSES}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="e.g. zane — prod"
            disabled={actions.isSubmitting}
          />
        </label>
        <Button type="submit" size="sm" disabled={newKey.trim() === "" || actions.isSubmitting}>
          {actions.isSubmitting ? "Verifying…" : "Add key"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isImporting}
          onClick={() => {
            setShowImport((v) => !v);
            setImportResults(null);
          }}
        >
          {showImport ? "Hide import" : "Import keys"}
        </Button>
      </form>

      {showImport && (
        <form className="space-y-2 rounded-md border border-border bg-card p-3" onSubmit={submitImport}>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Bulk import — one user-scoped API key per line
            </span>
            <textarea
              className={cn(INPUT_CLASSES, "min-h-24 font-mono")}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"key_...\nkey_...\nkey_..."}
              disabled={isImporting}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="text-[11px] text-muted-foreground">
            Each key is verified against Cursor and bound to its owning team
            member, one at a time. Lines that fail stay in the box so you can
            fix and retry them. A roster sync runs automatically afterwards,
            so the key badges reflect current team membership.
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={importKeyCount === 0 || isImporting}>
              {isImporting && importProgress
                ? `Importing ${importProgress.done + 1} of ${importProgress.total}…`
                : importKeyCount > 0
                  ? `Import ${importKeyCount} ${importKeyCount === 1 ? "key" : "keys"}`
                  : "Import keys"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isImporting}
              onClick={() => {
                setShowImport(false);
                setImportText("");
                setImportResults(null);
              }}
            >
              Close
            </Button>
          </div>
          {importResults && (
            <ul
              role="list"
              aria-label="Import results"
              className="m-0 list-none space-y-0.5 p-0 text-[11px]"
            >
              {importResults.map((result) => (
                <li
                  key={result.keyPreview}
                  className={result.ok ? "text-muted-foreground" : "text-destructive"}
                >
                  {result.keyPreview}: {result.message}
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
    </section>
  );
}

function MemberKeyRow({
  accountId,
  keyView,
  actions,
  onChanged,
}: {
  readonly accountId: string;
  readonly keyView: CursorMemberKeyView;
  readonly actions: ReturnType<typeof useCursorMemberKeyActions>;
  readonly onChanged: () => void;
}) {
  const key = keyView.key;
  if (!key) return null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground">
          {key.boundEmail}
          {key.label ? ` · ${key.label}` : ""}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {key.cursorKeyName || "unnamed key"}
          {keyView.spend
            ? ` · ${formatSpendMicros(
                keyView.spend.includedSpendUsdMicros + keyView.spend.overageSpendUsdMicros,
              )} this cycle`
            : ""}
          {keyView.spend && formatPoolPercent(keyView.spend.apiPercentUsed)
            ? ` · API pool ${formatPoolPercent(keyView.spend.apiPercentUsed)} used`
            : ""}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {/* Server-computed: same routability rule key selection runs. */}
        {keyView.usageGuardTripped && (
          <StateBadge tone="warn" label="Usage guard" />
        )}
        <KeyStateBadge state={keyView.state} enabled={key.enabled} />
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
    </li>
  );
}

// ---------------------------------------------------------------------------
// Badges (internal)
// ---------------------------------------------------------------------------

function StateBadge({
  tone,
  label,
}: {
  readonly tone: "ok" | "warn" | "muted";
  readonly label: string;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
        tone === "ok" && "bg-accent text-primary",
        tone === "warn" && "bg-muted-subtle text-destructive",
        tone === "muted" && "bg-muted-subtle text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function KeyStateBadge({
  state,
  enabled,
}: {
  readonly state: CursorMemberKeyState;
  readonly enabled: boolean;
}) {
  if (state === CursorMemberKeyState.member_key_owner_removed) {
    return <StateBadge tone="warn" label="Owner left team" />;
  }
  if (state === CursorMemberKeyState.member_key_owner_unknown) {
    return <StateBadge tone="muted" label="Owner unknown" />;
  }
  return enabled ? (
    <StateBadge tone="ok" label="Active" />
  ) : (
    <StateBadge tone="muted" label="Disabled" />
  );
}
