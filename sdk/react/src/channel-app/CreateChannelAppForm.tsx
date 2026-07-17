"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import {
  CHANNEL_PROVIDERS,
  type ChannelProviderId,
} from "../channel/providers.js";
import { useCreateChannelApp } from "./useCreateChannelApp.js";
import {
  buildSlackChannelAppManifest,
  slackChannelAppRedirectUrl,
} from "./slackAppSetup.js";
import { generateWhatsAppVerifyToken } from "./whatsappAppSetup.js";
import { CopyBlock, FormField, SpinnerIcon } from "./internal.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Values from the create flow that a host needs exactly once, right
 * after registration — they are encrypted server-side and answer
 * redacted from then on. The section flow threads them (client-side, in
 * memory only) into the detail panel so "finish setup at the provider"
 * can show them alongside the freshly-minted webhook URL.
 */
export interface ChannelAppCreateHandoff {
  /** The WhatsApp verify token as entered; absent for Slack apps. */
  readonly verifyToken?: string;
}

/** Props for {@link CreateChannelAppForm}. */
export interface CreateChannelAppFormProps {
  /** Organization slug — the channel app will be created in this org. */
  readonly org: string;
  /**
   * Console origin used to derive the OAuth redirect URL shown in the
   * Slack setup guidance. Defaults to the current window's origin.
   */
  readonly consoleOrigin?: string;
  /**
   * Fired with the newly created channel app on success. The handoff
   * carries the once-visible secrets the detail panel shows for
   * phase-two setup.
   */
  readonly onCreated?: (app: ChannelApp, handoff: ChannelAppCreateHandoff) => void;
  /** Fired when the user cancels creation. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Form for registering a customer-owned provider app as a
 * {@link ChannelApp} (bring your own app — the bot carries your name
 * and identity, and each app is its own bot identity).
 *
 * Provider-shaped: a Slack app brings OAuth credentials plus a
 * ready-to-paste manifest; a Meta (WhatsApp) app brings dashboard
 * credentials plus a generated verify token — Meta has no manifest
 * equivalent, so the guidance is a checklist.
 *
 * Setup is two-phase by nature for both providers (the provider mints
 * the credentials, Stigmer mints the per-app webhook URL): this form
 * covers phase one — the credentials. The detail panel shown after
 * creation carries phase two (the events webhook URL, plus the verify
 * token for WhatsApp).
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

  const [provider, setProvider] = useState<ChannelProviderId>("slack");
  const [name, setName] = useState("");

  // Slack credentials (Basic Information page on api.slack.com).
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [signingSecret, setSigningSecret] = useState("");

  // WhatsApp credentials (Meta app dashboard). The verify token is
  // customer-authored like every WhatsApp credential (DD-WA-3) —
  // pre-generated here as a strong default, editable for users bringing
  // their own.
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState(generateWhatsAppVerifyToken);

  const trimmedName = name.trim();

  const manifest = useMemo(
    () =>
      buildSlackChannelAppManifest({
        name: trimmedName || "Your Bot Name",
        redirectUrl: slackChannelAppRedirectUrl(consoleOrigin),
      }),
    [trimmedName, consoleOrigin],
  );

  const providerFieldsComplete =
    provider === "slack"
      ? clientId.trim() !== "" &&
        clientSecret.trim() !== "" &&
        signingSecret.trim() !== ""
      : appId.trim() !== "" &&
        appSecret.trim() !== "" &&
        accessToken.trim() !== "" &&
        verifyToken.trim() !== "";

  const canSubmit = trimmedName !== "" && providerFieldsComplete && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const app = await create({
          name: trimmedName,
          org,
          ...(provider === "slack"
            ? {
                slack: {
                  clientId: clientId.trim(),
                  clientSecret: clientSecret.trim(),
                  signingSecret: signingSecret.trim(),
                },
              }
            : {
                whatsapp: {
                  appId: appId.trim(),
                  appSecret: appSecret.trim(),
                  accessToken: accessToken.trim(),
                  verifyToken: verifyToken.trim(),
                },
              }),
        });
        onCreated?.(
          app,
          provider === "whatsapp" ? { verifyToken: verifyToken.trim() } : {},
        );
      } catch {
        // error state is managed by useCreateChannelApp
      }
    },
    [
      canSubmit,
      trimmedName,
      org,
      provider,
      clientId,
      clientSecret,
      signingSecret,
      appId,
      appSecret,
      accessToken,
      verifyToken,
      create,
      clearError,
      onCreated,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", className)}>
      <div className="space-y-3">
        <ProviderPicker
          value={provider}
          onChange={setProvider}
          disabled={isCreating}
        />

        <FormField
          id="stgm-chapp-name"
          label="Name"
          value={name}
          onChange={setName}
          placeholder={provider === "slack" ? "e.g. Acme Support Bot" : "e.g. Acme WhatsApp"}
          hint={
            provider === "slack"
              ? "The bot name your workspace will @mention"
              : "Names the app in Stigmer — pick something that identifies the Meta app"
          }
          disabled={isCreating}
          required
        />

        {provider === "slack" ? (
          <SlackCreateSection
            manifest={manifest}
            clientId={clientId}
            onClientIdChange={setClientId}
            clientSecret={clientSecret}
            onClientSecretChange={setClientSecret}
            signingSecret={signingSecret}
            onSigningSecretChange={setSigningSecret}
            disabled={isCreating}
          />
        ) : (
          <WhatsAppCreateSection
            appId={appId}
            onAppIdChange={setAppId}
            appSecret={appSecret}
            onAppSecretChange={setAppSecret}
            accessToken={accessToken}
            onAccessTokenChange={setAccessToken}
            verifyToken={verifyToken}
            onVerifyTokenChange={setVerifyToken}
            disabled={isCreating}
          />
        )}
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

// ---------------------------------------------------------------------------
// Provider picker
// ---------------------------------------------------------------------------

/**
 * Which provider the app belongs to — mutually exclusive and fixed for
 * the resource's lifetime (the spec oneof), so a radio group, chosen
 * before the fields it shapes.
 */
function ProviderPicker({
  value,
  onChange,
  disabled,
}: {
  readonly value: ChannelProviderId;
  readonly onChange: (id: ChannelProviderId) => void;
  readonly disabled: boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-xs font-medium text-foreground">
        Provider
      </legend>
      <div role="radiogroup" className="flex gap-1.5">
        {CHANNEL_PROVIDERS.map((p) => {
          const checked = value === p.id;
          return (
            <label
              key={p.id}
              htmlFor={`stgm-chapp-provider-${p.id}`}
              className={cn(
                "flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5",
                checked ? "border-ring bg-accent" : "border-border hover:bg-accent-hover",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <input
                id={`stgm-chapp-provider-${p.id}`}
                type="radio"
                name="stgm-chapp-provider"
                checked={checked}
                onChange={() => onChange(p.id)}
                disabled={disabled}
                className="accent-current"
              />
              <p.Icon className="size-3.5 shrink-0 text-foreground" />
              <span className="text-xs font-medium text-foreground">{p.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Slack — manifest + Basic Information credentials
// ---------------------------------------------------------------------------

function SlackCreateSection({
  manifest,
  clientId,
  onClientIdChange,
  clientSecret,
  onClientSecretChange,
  signingSecret,
  onSigningSecretChange,
  disabled,
}: {
  readonly manifest: string;
  readonly clientId: string;
  readonly onClientIdChange: (v: string) => void;
  readonly clientSecret: string;
  readonly onClientSecretChange: (v: string) => void;
  readonly signingSecret: string;
  readonly onSigningSecretChange: (v: string) => void;
  readonly disabled: boolean;
}) {
  return (
    <>
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
          onChange={onClientIdChange}
          placeholder="1234567890.0987654321"
          disabled={disabled}
          required
        />

        <FormField
          id="stgm-chapp-client-secret"
          label="Client secret"
          value={clientSecret}
          onChange={onClientSecretChange}
          placeholder="Client secret"
          type="password"
          disabled={disabled}
          required
        />

        <FormField
          id="stgm-chapp-signing-secret"
          label="Signing secret"
          value={signingSecret}
          onChange={onSigningSecretChange}
          placeholder="Signing secret"
          type="password"
          hint="Verifies that webhook events really come from your app"
          disabled={disabled}
          required
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp — Meta dashboard credentials + generated verify token
// ---------------------------------------------------------------------------

function WhatsAppCreateSection({
  appId,
  onAppIdChange,
  appSecret,
  onAppSecretChange,
  accessToken,
  onAccessTokenChange,
  verifyToken,
  onVerifyTokenChange,
  disabled,
}: {
  readonly appId: string;
  readonly onAppIdChange: (v: string) => void;
  readonly appSecret: string;
  readonly onAppSecretChange: (v: string) => void;
  readonly accessToken: string;
  readonly onAccessTokenChange: (v: string) => void;
  readonly verifyToken: string;
  readonly onVerifyTokenChange: (v: string) => void;
  readonly disabled: boolean;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground">
          1. Create the Meta app
        </p>
        <p className="text-[0.65rem] text-muted-foreground">
          On{" "}
          <a
            href="https://developers.facebook.com/apps"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:text-foreground underline transition-colors"
          >
            developers.facebook.com
          </a>
          , create a <span className="font-medium">Business</span>-type app
          and add the <span className="font-medium">WhatsApp</span> product.
          The webhook setup comes after the next step — the webhook URL is
          minted when this form is saved.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium text-foreground">
          2. Paste the app&apos;s credentials
        </p>
        <p className="-mt-2 text-[0.65rem] text-muted-foreground">
          The app ID and secret are on <span className="font-medium">App
          settings → Basic</span>; mint a long-lived system-user access
          token with WhatsApp permissions in Meta Business settings. The
          secrets are encrypted at rest and never shown again.
        </p>

        <FormField
          id="stgm-chapp-app-id"
          label="App ID"
          value={appId}
          onChange={onAppIdChange}
          placeholder="1234567890123456"
          disabled={disabled}
          required
        />

        <FormField
          id="stgm-chapp-app-secret"
          label="App secret"
          value={appSecret}
          onChange={onAppSecretChange}
          placeholder="App secret"
          type="password"
          hint="Verifies that webhook events really come from your app"
          disabled={disabled}
          required
        />

        <FormField
          id="stgm-chapp-access-token"
          label="Access token"
          value={accessToken}
          onChange={onAccessTokenChange}
          placeholder="Long-lived system-user access token"
          type="password"
          hint="Sends messages on behalf of your WhatsApp Business account"
          disabled={disabled}
          required
        />

        <FormField
          id="stgm-chapp-verify-token"
          label="Verify token"
          value={verifyToken}
          onChange={onVerifyTokenChange}
          placeholder="Verify token"
          hint={
            "Generated for you — you'll paste this same value into Meta's " +
            "webhook configuration after registering. Replace it if your " +
            "Meta app already has one."
          }
          disabled={disabled}
          required
        />
      </div>
    </>
  );
}
