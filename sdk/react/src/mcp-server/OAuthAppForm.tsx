"use client";

import { useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";

/** Props for {@link OAuthAppForm}. */
export interface OAuthAppFormProps {
  /**
   * Vendor / provider display name shown in the instruction text.
   * Example: `"Figma"`, `"Slack"`.
   */
  readonly providerName: string;
  /**
   * URL to the vendor's OAuth app registration page. When provided,
   * a help link is rendered so the user can register their app.
   */
  readonly vendorDocsUrl?: string | null;
  /**
   * Called when the form is submitted with valid credentials.
   * The parent is responsible for calling the `setOrgOAuthApp` mutation
   * and handling errors.
   */
  readonly onSubmit: (clientId: string, clientSecret: string) => Promise<void>;
  /** Called when the user cancels the form. */
  readonly onCancel: () => void;
  /** `true` while the submit mutation is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed submit, or `null`. */
  readonly error: Error | null;
  /** Additional CSS classes for the form root. */
  readonly className?: string;
}

/**
 * Two-field form for registering an org-level OAuth app override (BYOA).
 *
 * Collects only `client_id` and `client_secret` — all other OAuth
 * configuration (endpoint URLs, scopes) is cloned from the platform's
 * OAuthApp template by the backend.
 *
 * This is a pure presentational component with no dialog wrapper
 * (headless-first). The parent is responsible for rendering it inside
 * a `<dialog>`, modal, sheet, or inline context as needed. Platform
 * builders who want a different container can import just the form.
 *
 * All styling flows through `--stgm-*` design tokens via `cn()`.
 *
 * @example
 * ```tsx
 * <OAuthAppForm
 *   providerName="Figma"
 *   vendorDocsUrl="https://www.figma.com/developers/api#oauth2"
 *   onSubmit={async (clientId, clientSecret) => {
 *     await orgOAuthApp.setOrgOAuthApp(clientId, clientSecret);
 *     orgOAuthApp.refetch();
 *   }}
 *   onCancel={() => setShowForm(false)}
 *   isSubmitting={orgOAuthApp.isSetting}
 *   error={orgOAuthApp.setError}
 * />
 * ```
 */
export function OAuthAppForm({
  providerName,
  vendorDocsUrl,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
  className,
}: OAuthAppFormProps) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [secretRevealed, setSecretRevealed] = useState(false);

  const formId = useId();
  const clientIdId = `${formId}-client-id`;
  const clientSecretId = `${formId}-client-secret`;

  const canSubmit = clientId.trim().length > 0 && clientSecret.trim().length > 0;
  const isDisabled = isSubmitting;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit || isDisabled) return;
      await onSubmit(clientId.trim(), clientSecret.trim());
    },
    [canSubmit, isDisabled, onSubmit, clientId, clientSecret],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("flex flex-col gap-4", className)}
    >
      {/* Instructions */}
      <div className="space-y-1.5">
        <p className="text-sm text-foreground">
          Register an OAuth app with{" "}
          <span className="font-medium">{providerName}</span> and enter your
          credentials below.
        </p>
        {vendorDocsUrl && (
          <a
            href={vendorDocsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            {providerName} OAuth app registration
            <ExternalLinkIcon className="size-3 shrink-0" />
          </a>
        )}
      </div>

      {/* Fields */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={clientIdId} className="text-xs font-medium text-foreground">
            Client ID
          </label>
          <input
            id={clientIdId}
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={isDisabled}
            required
            aria-required
            autoComplete="off"
            autoFocus
            placeholder="e.g. 1234567890abcdef"
            className={cn(
              "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={clientSecretId} className="text-xs font-medium text-foreground">
            Client Secret
          </label>
          <div className="relative">
            <input
              id={clientSecretId}
              type={secretRevealed ? "text" : "password"}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={isDisabled}
              required
              aria-required
              autoComplete="off"
              placeholder="Your client secret"
              className={cn(
                "w-full rounded-md border border-input bg-background px-2.5 py-1.5 pr-8 text-xs text-foreground",
                "placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            />
            <button
              type="button"
              onClick={() => setSecretRevealed((v) => !v)}
              disabled={isDisabled}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2",
                "text-muted-foreground hover:text-foreground",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              aria-label={secretRevealed ? "Hide client secret" : "Show client secret"}
              tabIndex={-1}
            >
              {secretRevealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
        >
          {getUserMessage(error)}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isDisabled}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs",
            "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit || isDisabled}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isSubmitting && <SpinnerIcon />}
          Save
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Icons (internal to this module — avoids cross-file dependencies)
// ---------------------------------------------------------------------------

function ExternalLinkIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V10" />
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 8 8" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.59 6.59a2 2 0 0 0 2.82 2.82" />
      <path d="M10.73 10.73A6.5 6.5 0 0 1 8 12.5c-4 0-6.5-4.5-6.5-4.5a11.5 11.5 0 0 1 3.77-3.73" />
      <path d="M5.71 3.56A6.3 6.3 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11.5 11.5 0 0 1-1.28 1.73" />
      <path d="M2 2l12 12" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
