"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useUpdateChannelApp } from "./useUpdateChannelApp.js";
import { useDeleteChannelApp } from "./useDeleteChannelApp.js";
import {
  buildSlackChannelAppManifest,
  slackChannelAppRedirectUrl,
  slackChannelAppWebhookUrl,
} from "./slackAppSetup.js";
import { CopyBlock, CopyRow, FormField, SpinnerIcon } from "./internal.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link ChannelAppDetailPanel}. */
export interface ChannelAppDetailPanelProps {
  /** The channel app to display and edit (secret fields arrive redacted). */
  readonly channelApp: ChannelApp;
  /**
   * Console origin used to derive the OAuth redirect URL shown in the
   * setup guidance. Defaults to the current window's origin.
   */
  readonly consoleOrigin?: string;
  /** Fired with the updated app after a successful save. */
  readonly onUpdated?: (app: ChannelApp) => void;
  /** Fired after the app is deleted. */
  readonly onDeleted?: () => void;
  /** Fired when the user navigates back to the list. */
  readonly onBack?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Detail view for one {@link ChannelApp}: the "finish setup in Slack"
 * values (the app's own events webhook URL — phase two of the two-phase
 * setup — plus the completed manifest), credential rotation, and
 * deletion.
 *
 * Secret fields are prefilled with the redaction marker; leaving them
 * untouched preserves the stored values (rotate one secret without
 * re-entering the other). Deletion is refused server-side while any
 * agent channel still installs through this app.
 */
export function ChannelAppDetailPanel({
  channelApp,
  consoleOrigin,
  onUpdated,
  onDeleted,
  onBack,
  className,
}: ChannelAppDetailPanelProps) {
  const stigmer = useStigmer();
  const { update, isUpdating, error: updateError, clearError } = useUpdateChannelApp();
  const { deleteApp, isDeleting, error: deleteError } = useDeleteChannelApp();

  const slack = channelApp.spec?.providerConfig?.case === "slack"
    ? channelApp.spec.providerConfig.value
    : undefined;

  const [clientId, setClientId] = useState(slack?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState(slack?.clientSecret ?? "");
  const [signingSecret, setSigningSecret] = useState(slack?.signingSecret ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const appId = channelApp.metadata?.id ?? "";
  const name = channelApp.metadata?.name ?? "";

  const webhookUrl = useMemo(
    () => slackChannelAppWebhookUrl(stigmer.baseUrl, appId),
    [stigmer.baseUrl, appId],
  );
  const redirectUrl = useMemo(
    () => slackChannelAppRedirectUrl(consoleOrigin),
    [consoleOrigin],
  );
  const manifest = useMemo(
    () => buildSlackChannelAppManifest({ name, redirectUrl, webhookUrl }),
    [name, redirectUrl, webhookUrl],
  );

  const canSave =
    clientId.trim() !== "" &&
    clientSecret.trim() !== "" &&
    signingSecret.trim() !== "" &&
    !isUpdating;

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSave) return;

      clearError();
      try {
        const updated = await update({
          name,
          org: channelApp.metadata?.org ?? "",
          ...(channelApp.metadata?.slug ? { slug: channelApp.metadata.slug } : {}),
          slack: {
            clientId: clientId.trim(),
            // The redaction marker means "keep the stored value" — the
            // server preserves per field.
            clientSecret: clientSecret.trim(),
            signingSecret: signingSecret.trim(),
          },
        });
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateChannelApp
      }
    },
    [canSave, clearError, update, name, channelApp.metadata, clientId, clientSecret, signingSecret, onUpdated],
  );

  const handleDelete = useCallback(async () => {
    try {
      await deleteApp(appId);
      onDeleted?.();
    } catch {
      // error state is managed by useDeleteChannelApp
    } finally {
      setConfirmingDelete(false);
    }
  }, [deleteApp, appId, onDeleted]);

  return (
    <div className={cn("space-y-5", className)}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{name}</h3>
          <p className="font-mono text-[0.65rem] text-muted-foreground">{appId}</p>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground shrink-0 text-xs transition-colors"
          >
            ← Back
          </button>
        )}
      </div>

      {/* Finish setup: the per-app webhook URL only exists after creation */}
      <section className="space-y-2" aria-label="Finish setup in Slack">
        <p className="text-xs font-medium text-foreground">Finish setup in Slack</p>
        <p className="text-[0.65rem] text-muted-foreground">
          On the app&apos;s <span className="font-medium">Event
          Subscriptions</span> page, enable events and set the request URL
          below (Slack verifies it immediately). The completed manifest is
          also available for review or re-paste.
        </p>
        <CopyRow
          label="Events request URL"
          value={webhookUrl}
          copyTargetId="stgm-chapp-webhook-copy"
        />
        <CopyRow label="OAuth redirect URL" value={redirectUrl} />
        <CopyBlock label="Completed app manifest" value={manifest} />
      </section>

      {/* Credential rotation */}
      <form onSubmit={handleSave} className="space-y-3" aria-label="Credentials">
        <p className="text-xs font-medium text-foreground">Credentials</p>
        <p className="-mt-2 text-[0.65rem] text-muted-foreground">
          Secrets show as <code className="font-mono">***REDACTED***</code>;
          leave a field untouched to keep its stored value, or paste a new
          one to rotate it.
        </p>

        <FormField
          id="stgm-chapp-edit-client-id"
          label="Client ID"
          value={clientId}
          onChange={setClientId}
          placeholder="1234567890.0987654321"
          disabled={isUpdating}
          required
        />
        <FormField
          id="stgm-chapp-edit-client-secret"
          label="Client secret"
          value={clientSecret}
          onChange={setClientSecret}
          placeholder="Client secret"
          type="password"
          disabled={isUpdating}
          required
        />
        <FormField
          id="stgm-chapp-edit-signing-secret"
          label="Signing secret"
          value={signingSecret}
          onChange={setSigningSecret}
          placeholder="Signing secret"
          type="password"
          disabled={isUpdating}
          required
        />

        {updateError && (
          <p className="text-destructive text-[0.65rem]" role="alert">
            {getUserMessage(updateError)}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSave}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isUpdating && <SpinnerIcon />}
          Save credentials
        </button>
      </form>

      {/* Deletion */}
      <section className="border-t border-border pt-3" aria-label="Danger zone">
        {deleteError && (
          <p className="text-destructive mb-2 text-[0.65rem]" role="alert">
            {getUserMessage(deleteError)}
          </p>
        )}
        {confirmingDelete ? (
          <div className="flex items-center gap-2">
            <p className="text-xs text-foreground">
              Delete this channel app? Channels installing through it must be
              disconnected first.
            </p>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                "bg-destructive text-destructive-foreground hover:opacity-90",
                "disabled:pointer-events-none disabled:opacity-40",
              )}
            >
              {isDeleting && <SpinnerIcon />}
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={isDeleting}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-destructive text-xs font-medium hover:opacity-80"
          >
            Delete channel app
          </button>
        )}
      </section>
    </div>
  );
}
