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
import { Field, INPUT_CLASSES } from "../billing/form-primitives.js";

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
 * enablement, platform-default flag, and org assignments.
 *
 * Admin-key semantics mirror the server contract: on edit the field
 * shows the redaction marker and submitting it unchanged keeps the
 * stored key; typing anything else rotates it (validated live against
 * Cursor before persisting). Member keys are NOT edited here — they have
 * their own panel with per-key add/remove/enable.
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
  const [isPlatformDefault, setIsPlatformDefault] = useState(
    initial?.isPlatformDefault ?? false,
  );
  const [orgIdsText, setOrgIdsText] = useState(
    (initial?.orgIds ?? []).join("\n"),
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
        isPlatformDefault,
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

      <Field label="Assigned organization ids">
        <textarea
          className={cn(INPUT_CLASSES, "min-h-16 font-mono")}
          value={orgIdsText}
          onChange={(e) => setOrgIdsText(e.target.value)}
          placeholder={"one org id per line\n(each org may belong to only one account)"}
          disabled={isSubmitting}
        />
      </Field>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs text-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={isSubmitting}
          />
          Enabled for key selection
        </label>
        <label className="flex items-center gap-1.5 text-xs text-foreground">
          <input
            type="checkbox"
            checked={isPlatformDefault}
            onChange={(e) => setIsPlatformDefault(e.target.checked)}
            disabled={isSubmitting}
          />
          Platform default (serves unassigned orgs)
        </label>
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
