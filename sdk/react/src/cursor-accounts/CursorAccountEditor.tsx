"use client";

import { useState } from "react";
import { create } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import {
  CursorAccountSchema,
  type CursorAccount,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import { Button } from "../button/index.js";
import { Field, INPUT_CLASSES } from "../internal/form-primitives.js";

/**
 * The redaction marker the server uses for stored secrets. Sending it
 * back on update means "keep the stored admin key".
 */
const REDACTED = "***REDACTED***";

/** Props for {@link CursorAccountEditor}. */
export interface CursorAccountEditorProps {
  /** The account to edit, or `null` to create a new one. */
  readonly initial: CursorAccount | null;
  /** `true` while the save is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed save, or `null`. */
  readonly submitError: Error | null;
  /** Called with the assembled account on submit. */
  readonly onSubmit: (account: CursorAccount) => void;
  /** Called when the operator cancels. */
  readonly onCancel: () => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Create/edit form for one Cursor account: identity, team Admin API key,
 * enablement, and dedicated-org assignments. The account's class is
 * derived (DD-008): listed org ids make it DEDICATED to them, an empty
 * list makes it a shared-pool account — there is no flag to manage.
 *
 * Admin-key semantics mirror the server contract: on edit the field
 * shows the redaction marker and submitting it unchanged keeps the
 * stored key; typing anything else rotates it (validated live against
 * Cursor before persisting). Member keys are NOT edited here — they have
 * their own panel with per-key add/remove/enable.
 *
 * The optional team invite link (Cursor dashboard → Invite Members →
 * Copy Invite Link) round-trips readable — no marker — and powers the
 * coverage table's "Copy invite" action for off-team key owners.
 */
export function CursorAccountEditor({
  initial,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
  className,
}: CursorAccountEditorProps) {
  const isCreate = initial === null;
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [adminApiKey, setAdminApiKey] = useState(isCreate ? "" : REDACTED);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  // UI state is the positive ("on-demand enabled", Cursor's own wording and
  // team default); the proto field is the negative so absence means
  // "assume Cursor's default" on documents that predate the field.
  const [onDemandEnabled, setOnDemandEnabled] = useState(
    !(initial?.onDemandUsageDisabled ?? false),
  );
  const [orgIdsText, setOrgIdsText] = useState(
    (initial?.orgIds ?? []).join("\n"),
  );
  // Unlike the admin key, the invite link round-trips readable (the
  // server decrypts it on read — operators must be able to copy it), so
  // there is no redaction-marker dance: edit the value directly.
  const [teamInviteLink, setTeamInviteLink] = useState(
    initial?.teamInviteLink ?? "",
  );

  const canSubmit =
    displayName.trim() !== "" && adminApiKey.trim() !== "" && !isSubmitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(
      create(CursorAccountSchema, {
        accountId: initial?.accountId ?? "",
        displayName: displayName.trim(),
        adminApiKey: adminApiKey.trim(),
        enabled,
        // is_platform_default is deprecated (DD-008): the shared pool is
        // derived from empty org_ids, so current clients never write it.
        onDemandUsageDisabled: !onDemandEnabled,
        teamInviteLink: teamInviteLink.trim(),
        orgIds: orgIdsText
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter((s) => s !== ""),
      }),
    );
  };

  return (
    <form className={cn("max-w-xl space-y-3", className)} onSubmit={handleSubmit}>
      <h3 className="text-sm font-semibold text-foreground">
        {isCreate ? "Add Cursor account" : `Edit ${initial.displayName}`}
      </h3>

      <Field label="Display name" required>
        <input
          className={INPUT_CLASSES}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. scenar.ai team"
          disabled={isSubmitting}
        />
      </Field>

      <Field label="Team Admin API key" required>
        <input
          className={INPUT_CLASSES}
          type="password"
          value={adminApiKey}
          onChange={(e) => setAdminApiKey(e.target.value)}
          placeholder="key from Cursor dashboard → API → Team tab"
          disabled={isSubmitting}
          autoComplete="off"
        />
      </Field>
      {!isCreate && (
        <p className="text-[11px] text-muted-foreground">
          Leave the masked value untouched to keep the stored key; typing a
          new key rotates it (validated against Cursor before saving).
        </p>
      )}

      <Field label="Team invite link">
        <input
          className={INPUT_CLASSES}
          type="url"
          value={teamInviteLink}
          onChange={(e) => setTeamInviteLink(e.target.value)}
          placeholder="https://… (Cursor dashboard → Invite Members → Copy Invite Link)"
          disabled={isSubmitting}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <p className="text-[11px] text-muted-foreground">
        Optional. Powers one-click &quot;Copy invite&quot; on coverage rows
        whose key owner is not on the team. The link is long-lived and
        joinable by anyone holding it (each join consumes a paid seat) —
        share it deliberately, and revoke or rotate it from the Cursor
        dashboard. Leave empty to clear.
      </p>

      <Field label="Dedicated organization ids">
        <textarea
          className={cn(INPUT_CLASSES, "min-h-16 font-mono")}
          value={orgIdsText}
          onChange={(e) => setOrgIdsText(e.target.value)}
          placeholder={"one org id per line\n(leave empty for a shared-pool account)"}
          disabled={isSubmitting}
        />
      </Field>
      <p className="text-[11px] text-muted-foreground">
        Listing org ids DEDICATES this account to them: their sessions use
        only this account&apos;s keys and fail with a clear message when it
        runs dry. Leaving this empty makes the account part of the shared
        pool that serves every other org — pool sessions may move between
        pool accounts when one is depleted. Each org may appear in at most
        one account.
      </p>

      <div className="space-y-2">
        <div>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={isSubmitting}
            />
            Enabled for key selection
          </label>
          <p className="mt-0.5 pl-[1.375rem] text-[11px] text-muted-foreground">
            Leave checked for accounts that should serve traffic. Unchecking
            drains the account: new sessions stop routing here immediately,
            but sessions already pinned to one of its keys keep working.
          </p>
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={onDemandEnabled}
              onChange={(e) => setOnDemandEnabled(e.target.checked)}
              disabled={isSubmitting}
            />
            On-demand usage enabled (as configured in the Cursor dashboard)
          </label>
          <p className="mt-0.5 pl-[1.375rem] text-[11px] text-muted-foreground">
            Declared here because Cursor&apos;s Admin API cannot report the
            team&apos;s on-demand setting. Uncheck only when the dashboard has
            on-demand usage OFF: new sessions then avoid member keys whose
            included third-party (API) pool is nearly spent, since such keys
            can no longer serve third-party models at all.
          </p>
        </div>
      </div>

      {submitError && (
        <p className="text-destructive text-xs" role="alert">
          {getUserMessage(submitError)}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {isSubmitting ? "Saving…" : isCreate ? "Create account" : "Save changes"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
