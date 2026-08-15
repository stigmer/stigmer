"use client";

import { type FormEvent, useCallback, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, toChannelAppUpdateInput } from "@stigmer/sdk";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useUpdateChannelApp } from "./useUpdateChannelApp.js";
import { useDeleteChannelApp } from "./useDeleteChannelApp.js";
import type { ChannelAppCreateHandoff } from "./CreateChannelAppForm.js";
import {
  buildSlackChannelAppManifest,
  slackChannelAppRedirectUrl,
  slackChannelAppWebhookUrl,
} from "./slackAppSetup.js";
import {
  WHATSAPP_CHANNEL_APP_WEBHOOK_FIELDS,
  whatsappChannelAppWebhookUrl,
} from "./whatsappAppSetup.js";
import { CopyBlock, CopyRow, FormField } from "./internal.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link ChannelAppDetailPanel}. */
export interface ChannelAppDetailPanelProps {
  /** The channel app to display and edit (secret fields arrive redacted). */
  readonly channelApp: ChannelApp;
  /**
   * Console origin used to derive the OAuth redirect URL shown in the
   * Slack setup guidance. Defaults to the current window's origin.
   */
  readonly consoleOrigin?: string;
  /**
   * Once-visible values threaded from the create flow (in memory only).
   * The WhatsApp verify token is entered at registration but answers
   * redacted from then on, and phase-two setup needs it *together with*
   * the webhook URL that only exists now — this handoff lets the panel
   * show both, exactly once. Absent on a later visit, the token renders
   * redacted (rotate to get a fresh one).
   */
  readonly createHandoff?: ChannelAppCreateHandoff;
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
 * Detail view for one {@link ChannelApp}: the "finish setup at the
 * provider" values — phase two of the two-phase setup — plus credential
 * rotation and deletion.
 *
 * Provider-shaped bodies on a shared frame: a Slack app shows its
 * events webhook URL, OAuth redirect URL, and completed manifest; a
 * Meta (WhatsApp) app shows its webhook URL and verify token (no
 * manifest — Meta has no equivalent, so the guidance is a checklist).
 *
 * Secret fields are prefilled with the redaction marker; leaving them
 * untouched preserves the stored values (rotate one secret without
 * re-entering the others). Deletion is refused server-side while any
 * agent channel still installs through this app.
 */
export function ChannelAppDetailPanel({
  channelApp,
  consoleOrigin,
  createHandoff,
  onUpdated,
  onDeleted,
  onBack,
  className,
}: ChannelAppDetailPanelProps) {
  const { deleteApp, isDeleting, error: deleteError } = useDeleteChannelApp();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const appId = channelApp.metadata?.id ?? "";
  const name = channelApp.metadata?.name ?? "";
  const providerCase = channelApp.spec?.providerConfig?.case;

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
    <div className={cn("stg:space-y-5", className)}>
      <div className="stg:flex stg:items-center stg:justify-between">
        <div className="stg:min-w-0">
          <h3 className="stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">{name}</h3>
          <p className="stg:font-mono stg:text-[0.65rem] stg:text-muted-foreground">{appId}</p>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="stg:text-muted-foreground stg:hover:text-foreground stg:shrink-0 stg:text-xs stg:transition-colors"
          >
            ← Back
          </button>
        )}
      </div>

      {providerCase === "slack" ? (
        <SlackAppDetail
          channelApp={channelApp}
          consoleOrigin={consoleOrigin}
          onUpdated={onUpdated}
        />
      ) : providerCase === "whatsapp" ? (
        <WhatsAppAppDetail
          channelApp={channelApp}
          createHandoff={createHandoff}
          onUpdated={onUpdated}
        />
      ) : null}

      {/* Deletion */}
      <section className="stg:border-t stg:border-border stg:pt-3" aria-label="Danger zone">
        {deleteError && (
          <p className="stg:text-destructive stg:mb-2 stg:text-[0.65rem]" role="alert">
            {getUserMessage(deleteError)}
          </p>
        )}
        {confirmingDelete ? (
          <div className="stg:flex stg:items-center stg:gap-2">
            <p className="stg:text-xs stg:text-foreground">
              Delete this channel app? Channels installing through it must be
              disconnected first.
            </p>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className={cn(
                "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                "stg:bg-destructive stg:text-destructive-foreground stg:hover:opacity-90",
                "stg:disabled:pointer-events-none stg:disabled:opacity-40",
              )}
            >
              {isDeleting && <SpinnerIcon size={12} />}
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={isDeleting}
              className="stg:text-muted-foreground stg:hover:text-foreground stg:text-xs stg:transition-colors"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="stg:text-destructive stg:text-xs stg:font-medium stg:hover:opacity-80"
          >
            Delete channel app
          </button>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slack — finish setup in Slack + credential rotation
// ---------------------------------------------------------------------------

function SlackAppDetail({
  channelApp,
  consoleOrigin,
  onUpdated,
}: {
  readonly channelApp: ChannelApp;
  readonly consoleOrigin?: string;
  readonly onUpdated?: (app: ChannelApp) => void;
}) {
  const baseId = useId();
  const stigmer = useStigmer();
  const { update, isUpdating, error: updateError, clearError } = useUpdateChannelApp();

  const slack = channelApp.spec?.providerConfig?.case === "slack"
    ? channelApp.spec.providerConfig.value
    : undefined;

  const [clientId, setClientId] = useState(slack?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState(slack?.clientSecret ?? "");
  const [signingSecret, setSigningSecret] = useState(slack?.signingSecret ?? "");

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
        // Full-spec-replace safety: spread the complete mapped input and
        // override only the slack arm this form owns.
        const updated = await update({
          ...toChannelAppUpdateInput(channelApp),
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
    [canSave, clearError, update, channelApp, clientId, clientSecret, signingSecret, onUpdated],
  );

  return (
    <>
      {/* Finish setup: the per-app webhook URL only exists after creation */}
      <section className="stg:space-y-2" aria-label="Finish setup in Slack">
        <p className="stg:text-xs stg:font-medium stg:text-foreground">Finish setup in Slack</p>
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          On the app&apos;s <span className="stg:font-medium">Event
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
      <form onSubmit={handleSave} className="stg:space-y-3" aria-label="Credentials">
        <p className="stg:text-xs stg:font-medium stg:text-foreground">Credentials</p>
        <p className="stg:-mt-2 stg:text-[0.65rem] stg:text-muted-foreground">
          Secrets show as <code className="stg:font-mono">***REDACTED***</code>;
          leave a field untouched to keep its stored value, or paste a new
          one to rotate it.
        </p>

        <FormField
          id={`${baseId}-client-id`}
          label="Client ID"
          value={clientId}
          onChange={setClientId}
          placeholder="1234567890.0987654321"
          disabled={isUpdating}
          required
        />
        <FormField
          id={`${baseId}-client-secret`}
          label="Client secret"
          value={clientSecret}
          onChange={setClientSecret}
          placeholder="Client secret"
          type="password"
          disabled={isUpdating}
          required
        />
        <FormField
          id={`${baseId}-signing-secret`}
          label="Signing secret"
          value={signingSecret}
          onChange={setSigningSecret}
          placeholder="Signing secret"
          type="password"
          disabled={isUpdating}
          required
        />

        {updateError && (
          <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
            {getUserMessage(updateError)}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSave}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isUpdating && <SpinnerIcon size={12} />}
          Save credentials
        </button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp — finish setup in Meta + credential rotation
// ---------------------------------------------------------------------------

function WhatsAppAppDetail({
  channelApp,
  createHandoff,
  onUpdated,
}: {
  readonly channelApp: ChannelApp;
  readonly createHandoff?: ChannelAppCreateHandoff;
  readonly onUpdated?: (app: ChannelApp) => void;
}) {
  const baseId = useId();
  const stigmer = useStigmer();
  const { update, isUpdating, error: updateError, clearError } = useUpdateChannelApp();

  const whatsapp = channelApp.spec?.providerConfig?.case === "whatsapp"
    ? channelApp.spec.providerConfig.value
    : undefined;

  const [metaAppId, setMetaAppId] = useState(whatsapp?.appId ?? "");
  const [appSecret, setAppSecret] = useState(whatsapp?.appSecret ?? "");
  const [accessToken, setAccessToken] = useState(whatsapp?.accessToken ?? "");
  const [verifyToken, setVerifyToken] = useState(whatsapp?.verifyToken ?? "");

  const appId = channelApp.metadata?.id ?? "";
  const name = channelApp.metadata?.name ?? "";

  const webhookUrl = useMemo(
    () => whatsappChannelAppWebhookUrl(stigmer.baseUrl, appId),
    [stigmer.baseUrl, appId],
  );

  const canSave =
    metaAppId.trim() !== "" &&
    appSecret.trim() !== "" &&
    accessToken.trim() !== "" &&
    verifyToken.trim() !== "" &&
    !isUpdating;

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSave) return;

      clearError();
      try {
        // Full-spec-replace safety: spread the complete mapped input and
        // override only the whatsapp arm this form owns.
        const updated = await update({
          ...toChannelAppUpdateInput(channelApp),
          whatsapp: {
            appId: metaAppId.trim(),
            // The redaction marker means "keep the stored value" — the
            // server preserves per field.
            appSecret: appSecret.trim(),
            accessToken: accessToken.trim(),
            verifyToken: verifyToken.trim(),
          },
        });
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateChannelApp
      }
    },
    [canSave, clearError, update, channelApp, metaAppId, appSecret, accessToken, verifyToken, onUpdated],
  );

  return (
    <>
      {/* Finish setup: the per-app webhook URL only exists after creation,
          and the verify token is only visible in the create handoff. */}
      <section className="stg:space-y-2" aria-label="Finish setup in Meta">
        <p className="stg:text-xs stg:font-medium stg:text-foreground">Finish setup in Meta</p>
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          On the app&apos;s <span className="stg:font-medium">WhatsApp →
          Configuration</span> page, set the callback URL and verify token
          below, click <span className="stg:font-medium">Verify and save</span>{" "}
          (Meta verifies immediately), then subscribe to the{" "}
          <span className="stg:font-medium">
            {WHATSAPP_CHANNEL_APP_WEBHOOK_FIELDS.join(", ")}
          </span>{" "}
          webhook field.
        </p>
        <CopyRow
          label="Callback URL"
          value={webhookUrl}
          copyTargetId="stgm-chapp-webhook-copy"
        />
        {createHandoff?.verifyToken ? (
          <CopyRow
            label="Verify token"
            value={createHandoff.verifyToken}
            copyTargetId="stgm-chapp-verify-token-copy"
          />
        ) : (
          <div className="stg:space-y-1">
            <p className="stg:text-xs stg:font-medium stg:text-foreground">Verify token</p>
            <p className="stg:text-[0.65rem] stg:text-muted-foreground">
              Shown once at registration. If you no longer have it, paste a
              new one below and update Meta&apos;s webhook configuration to
              match.
            </p>
          </div>
        )}
      </section>

      {/* Credential rotation */}
      <form onSubmit={handleSave} className="stg:space-y-3" aria-label="Credentials">
        <p className="stg:text-xs stg:font-medium stg:text-foreground">Credentials</p>
        <p className="stg:-mt-2 stg:text-[0.65rem] stg:text-muted-foreground">
          Secrets show as <code className="stg:font-mono">***REDACTED***</code>;
          leave a field untouched to keep its stored value, or paste a new
          one to rotate it.
        </p>

        <FormField
          id={`${baseId}-app-id`}
          label="App ID"
          value={metaAppId}
          onChange={setMetaAppId}
          placeholder="1234567890123456"
          disabled={isUpdating}
          required
        />
        <FormField
          id={`${baseId}-app-secret`}
          label="App secret"
          value={appSecret}
          onChange={setAppSecret}
          placeholder="App secret"
          type="password"
          disabled={isUpdating}
          required
        />
        <FormField
          id={`${baseId}-access-token`}
          label="Access token"
          value={accessToken}
          onChange={setAccessToken}
          placeholder="Long-lived system-user access token"
          type="password"
          disabled={isUpdating}
          required
        />
        <FormField
          id={`${baseId}-verify-token`}
          label="Verify token"
          value={verifyToken}
          onChange={setVerifyToken}
          placeholder="Verify token"
          type="password"
          hint="Rotating it? Update Meta's webhook configuration to the same value."
          disabled={isUpdating}
          required
        />

        {updateError && (
          <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
            {getUserMessage(updateError)}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSave}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isUpdating && <SpinnerIcon size={12} />}
          Save credentials
        </button>
      </form>
    </>
  );
}
