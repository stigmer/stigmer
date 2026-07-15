"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { useCreateChannelApp } from "./useCreateChannelApp.js";
import {
  buildSlackChannelAppManifest,
  slackChannelAppRedirectUrl,
} from "./slackAppSetup.js";
import { CopyBlock, FormField, SpinnerIcon } from "./internal.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link CreateChannelAppForm}. */
export interface CreateChannelAppFormProps {
  /** Organization slug — the channel app will be created in this org. */
  readonly org: string;
  /**
   * Console origin used to derive the OAuth redirect URL shown in the
   * setup guidance. Defaults to the current window's origin.
   */
  readonly consoleOrigin?: string;
  /** Fired with the newly created channel app on success. */
  readonly onCreated?: (app: ChannelApp) => void;
  /** Fired when the user cancels creation. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Form for registering a customer-owned Slack app as a {@link ChannelApp}
 * (bring your own app — the bot carries your name and icon, and each app
 * is its own bot identity, so multiple agents can serve one workspace).
 *
 * Setup is two-phase by nature (Slack mints the credentials, Stigmer
 * mints the per-app webhook URL): this form covers phase one — a
 * ready-to-paste app manifest plus the credential fields from the app's
 * "Basic Information" page. The detail panel shown after creation
 * carries phase two (the events webhook URL).
 *
 * This is a pure presentational component with no dialog wrapper
 * (headless-first). All visual properties flow through `--stgm-*`
 * design tokens.
 */
export function CreateChannelAppForm({
  org,
  consoleOrigin,
  onCreated,
  onCancel,
  className,
}: CreateChannelAppFormProps) {
  const { create, isCreating, error, clearError } = useCreateChannelApp();

  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [signingSecret, setSigningSecret] = useState("");

  const trimmedName = name.trim();

  const manifest = useMemo(
    () =>
      buildSlackChannelAppManifest({
        name: trimmedName || "Your Bot Name",
        redirectUrl: slackChannelAppRedirectUrl(consoleOrigin),
      }),
    [trimmedName, consoleOrigin],
  );

  const canSubmit =
    trimmedName !== "" &&
    clientId.trim() !== "" &&
    clientSecret.trim() !== "" &&
    signingSecret.trim() !== "" &&
    !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const app = await create({
          name: trimmedName,
          org,
          slack: {
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
            signingSecret: signingSecret.trim(),
          },
        });
        onCreated?.(app);
      } catch {
        // error state is managed by useCreateChannelApp
      }
    },
    [
      canSubmit,
      trimmedName,
      org,
      clientId,
      clientSecret,
      signingSecret,
      create,
      clearError,
      onCreated,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", className)}>
      <div className="space-y-3">
        <FormField
          id="stgm-chapp-name"
          label="Name"
          value={name}
          onChange={setName}
          placeholder="e.g. Acme Support Bot"
          hint="The bot name your workspace will @mention"
          disabled={isCreating}
          required
        />

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">
            1. Create the Slack app
          </p>
          <p className="text-[0.65rem] text-muted-foreground">
            On{" "}
            <a
              href="https://api.slack.com/apps?new_app=1"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:text-foreground underline transition-colors"
            >
              api.slack.com/apps
            </a>
            , choose <span className="font-medium">From a manifest</span> and
            paste this. Event subscriptions come after the next step — the
            webhook URL is minted when this form is saved.
          </p>
          <CopyBlock
            label="Slack app manifest"
            value={manifest}
            copyTargetId="stgm-chapp-manifest-copy"
          />
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-foreground">
            2. Paste the app&apos;s credentials
          </p>
          <p className="-mt-2 text-[0.65rem] text-muted-foreground">
            From the app&apos;s <span className="font-medium">Basic
            Information</span> page. They are encrypted at rest and never
            shown again.
          </p>

          <FormField
            id="stgm-chapp-client-id"
            label="Client ID"
            value={clientId}
            onChange={setClientId}
            placeholder="1234567890.0987654321"
            disabled={isCreating}
            required
          />

          <FormField
            id="stgm-chapp-client-secret"
            label="Client secret"
            value={clientSecret}
            onChange={setClientSecret}
            placeholder="Client secret"
            type="password"
            disabled={isCreating}
            required
          />

          <FormField
            id="stgm-chapp-signing-secret"
            label="Signing secret"
            value={signingSecret}
            onChange={setSigningSecret}
            placeholder="Signing secret"
            type="password"
            hint="Verifies that webhook events really come from your app"
            disabled={isCreating}
            required
          />
        </div>
      </div>

      {error && (
        <p className="text-destructive text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon />}
          Register channel app
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
