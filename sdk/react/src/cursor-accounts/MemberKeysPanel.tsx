"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { CursorAccountView } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import { Button } from "../button/index.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { INPUT_CLASSES } from "../internal/form-primitives.js";
import { toError } from "../internal/toError.js";
import type { CursorAccountCoverage } from "./cursor-account-coverage.js";
import { MemberCoverageTable } from "./MemberCoverageTable.js";
import type { useCursorMemberKeyActions } from "./useCursorMemberKeyActions.js";

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

/**
 * The team-coverage panel of one Cursor account: the roster-coverage
 * table (every member and key in three explicit categories) plus the
 * add-key and bulk-import forms.
 *
 * Bulk import is sequential on purpose: each key is validated live
 * against Cursor's /v1/me, and per-key errors (wrong key class, revoked,
 * duplicate) must be attributable to their line. Keys whose owner turns
 * out not to be on the team are still added — the post-import sync lands
 * them in the table's "not on the team" category with invite guidance.
 */
export function MemberKeysPanel({
  accountId,
  view,
  coverage,
  actions,
  onChanged,
  onImported,
}: {
  readonly accountId: string;
  readonly view: CursorAccountView;
  /** Derived once by the parent (also feeds its header member count). */
  readonly coverage: CursorAccountCoverage;
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

  const keyViews = view.keyViews;
  const hasRows =
    coverage.unclassified.length > 0 ||
    coverage.onTeamWithKey.length > 0 ||
    coverage.onTeamWithoutKey.length > 0 ||
    coverage.offTeamWithKey.length > 0;

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
    <section className="stg:space-y-2">
      <div>
        <h4 className="stg:text-xs stg:font-semibold stg:text-foreground">Team coverage</h4>
        {/* One-line health subtitle so the coverage answer is readable
            even when the gap group sits below the fold. The counts are
            the table's own groups (no re-derivation); the gap count is
            the attention point, tinted only when it is non-zero. Before
            the first sync there is nothing to classify, so no subtitle. */}
        {coverage.hasRoster && (
          <p className="stg:text-[11px] stg:text-muted-foreground">
            {coverage.onTeamWithKey.length} covered
            {" · "}
            <span
              className={cn(
                coverage.onTeamWithoutKey.length > 0 &&
                  "stg:font-medium stg:text-destructive",
              )}
            >
              {coverage.onTeamWithoutKey.length} without keys
            </span>
            {coverage.offTeamWithKey.length > 0
              ? ` · ${coverage.offTeamWithKey.length} off-team`
              : ""}
          </p>
        )}
      </div>

      {keyViews.length === 0 && (
        <p className="stg:text-xs stg:text-muted-foreground" role="status">
          No execution keys — this account is <strong>not routable</strong>.
          Add a member's user-scoped API key below.
        </p>
      )}

      {hasRows && (
        <MemberCoverageTable
          accountId={accountId}
          coverage={coverage}
          inviteLink={view.account?.teamInviteLink ?? ""}
          actions={actions}
          onChanged={onChanged}
        />
      )}

      {actions.error && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(actions.error)}
        </p>
      )}

      <form className="stg:flex stg:flex-wrap stg:items-end stg:gap-2" onSubmit={submitNewKey}>
        <label className="stg:block stg:min-w-56 stg:flex-1 stg:space-y-1">
          <span className="stg:text-[11px] stg:font-medium stg:text-muted-foreground">
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
        <label className="stg:block stg:min-w-40 stg:space-y-1">
          <span className="stg:text-[11px] stg:font-medium stg:text-muted-foreground">
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
        <form className="stg:space-y-2 stg:rounded-md stg:border stg:border-border stg:bg-card stg:p-3" onSubmit={submitImport}>
          <label className="stg:block stg:space-y-1">
            <span className="stg:text-[11px] stg:font-medium stg:text-muted-foreground">
              Bulk import — one user-scoped API key per line
            </span>
            <textarea
              className={cn(INPUT_CLASSES, "stg:min-h-24 stg:font-mono")}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"key_...\nkey_...\nkey_..."}
              disabled={isImporting}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="stg:text-[11px] stg:text-muted-foreground">
            Each key is verified against Cursor and bound to its owning team
            member, one at a time. Lines that fail stay in the box so you can
            fix and retry them. A roster sync runs automatically afterwards,
            so the coverage table reflects current team membership.
          </p>
          <div className="stg:flex stg:items-center stg:gap-2">
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
              className={cn(UNSTYLED_LIST, "stg:space-y-0.5 stg:text-[11px]")}
            >
              {importResults.map((result) => (
                <li
                  key={result.keyPreview}
                  className={result.ok ? "stg:text-muted-foreground" : "stg:text-destructive"}
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
