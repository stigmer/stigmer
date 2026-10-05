"use client";

import { type FormEvent, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { EXPECTED_AUDIENCE_HINT, EXPECTED_AUDIENCE_PLACEHOLDER } from "./copy.js";
import {
  EMPTY_SIGN_IN_SETTINGS,
  SignInSettingsSection,
  signInSettingsComplete,
  toSignInInput,
  useSignInSettings,
} from "./SignInSettings.js";
import { useCreateIdentityProvider } from "./useCreateIdentityProvider.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link CreateIdentityProviderForm}. */
export interface CreateIdentityProviderFormProps {
  /** Organization id — the IdP will be created in this org (a slug is also accepted). */
  readonly org: string;
  /** Fired with the newly created identity provider on success. */
  readonly onCreated?: (idp: IdentityProvider) => void;
  /** Fired when the user cancels creation. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Form for creating a new identity provider within an organization.
 *
 * Collects the required OIDC trust configuration: **name** (display
 * name), **JWKS URI**, **allowed issuers**, and **expected audience**.
 * Optionally enables SSO by toggling the SSO switch and providing an
 * **OIDC client ID**, and sets what a sign-in does: whether it creates
 * the person's account, the role granted on their first sign-in to the
 * organization, and the claim that binds a token to an organization. An
 * SSO provider starts with account creation on and the viewer role.
 *
 * On success it fires `onCreated` with the full {@link IdentityProvider}
 * response.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <CreateIdentityProviderForm
 *   org="acme"
 *   onCreated={(idp) => {
 *     refetch();
 *     setShowForm(false);
 *   }}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function CreateIdentityProviderForm({
  org,
  onCreated,
  onCancel,
  className,
}: CreateIdentityProviderFormProps) {
  const baseId = useId();
  const { create, isCreating, error, clearError } =
    useCreateIdentityProvider();

  const [name, setName] = useState("");
  const [jwksUri, setJwksUri] = useState("");
  const [issuers, setIssuers] = useState("");
  const [audience, setAudience] = useState("");
  const [isSso, setIsSso] = useState(false);
  const [oidcClientId, setOidcClientId] = useState("");

  const { signIn, setSignIn, switchSso } = useSignInSettings(
    () => EMPTY_SIGN_IN_SETTINGS,
  );

  const handleSsoToggle = useCallback(() => {
    const next = !isSso;
    setIsSso(next);
    switchSso(next);
  }, [isSso, switchSso]);

  const trimmedName = name.trim();
  const trimmedJwksUri = jwksUri.trim();
  const trimmedIssuers = issuers.trim();
  const trimmedAudience = audience.trim();
  const canSubmit =
    trimmedName !== "" &&
    trimmedJwksUri !== "" &&
    trimmedIssuers !== "" &&
    trimmedAudience !== "" &&
    (!isSso || oidcClientId.trim() !== "") &&
    signInSettingsComplete(signIn, isSso) &&
    !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const idp = await create({
          name: trimmedName,
          org,
          jwksUri: trimmedJwksUri,
          allowedIssuers: trimmedIssuers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          expectedAudience: trimmedAudience,
          ...(isSso && {
            isSsoProvider: true,
            oidcClientId: oidcClientId.trim(),
          }),
          ...toSignInInput(signIn, isSso),
        });
        onCreated?.(idp);
      } catch {
        // error state is managed by useCreateIdentityProvider
      }
    },
    [
      canSubmit,
      trimmedName,
      org,
      trimmedJwksUri,
      trimmedIssuers,
      trimmedAudience,
      isSso,
      oidcClientId,
      signIn,
      create,
      clearError,
      onCreated,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
      <div className="stg:space-y-3">
        <FormField
          id={`${baseId}-name`}
          label="Name"
          value={name}
          onChange={setName}
          placeholder="e.g. Acme Corp SSO"
          disabled={isCreating}
          required
        />

        <FormField
          id={`${baseId}-jwks`}
          label="JWKS URI"
          value={jwksUri}
          onChange={setJwksUri}
          placeholder="https://example.com/.well-known/jwks.json"
          disabled={isCreating}
          required
        />

        <FormField
          id={`${baseId}-issuers`}
          label="Allowed issuers"
          value={issuers}
          onChange={setIssuers}
          placeholder="issuer-1, issuer-2"
          hint="Comma-separated list of trusted JWT issuer values"
          disabled={isCreating}
          required
        />

        <FormField
          id={`${baseId}-audience`}
          label="Expected audience"
          value={audience}
          onChange={setAudience}
          placeholder={EXPECTED_AUDIENCE_PLACEHOLDER}
          hint={EXPECTED_AUDIENCE_HINT}
          disabled={isCreating}
          required
        />

        {/* SSO toggle */}
        <div className="stg:flex stg:items-center stg:gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={isSso}
            onClick={handleSsoToggle}
            disabled={isCreating}
            className={cn(
              "stg:relative stg:inline-flex stg:h-5 stg:w-9 stg:shrink-0 stg:cursor-pointer stg:rounded-full stg:border-2 stg:border-transparent stg:transition-colors",
              isSso ? "stg:bg-primary" : "stg:bg-muted",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            <span
              className={cn(
                "stg:pointer-events-none stg:inline-block stg:h-4 stg:w-4 stg:rounded-full stg:bg-background stg:shadow-sm stg:ring-0 stg:transition-transform",
                isSso ? "stg:translate-x-4" : "stg:translate-x-0",
              )}
            />
          </button>
          <span className="stg:text-xs stg:font-medium stg:text-foreground">
            SSO provider
          </span>
        </div>

        {isSso && (
          <FormField
            id={`${baseId}-client-id`}
            label="OIDC client ID"
            value={oidcClientId}
            onChange={setOidcClientId}
            placeholder="public-client-id"
            hint="Client ID for the PKCE-based Authorization Code flow"
            disabled={isCreating}
            required
          />
        )}

        <SignInSettingsSection
          isSso={isSso}
          value={signIn}
          onChange={setSignIn}
          disabled={isCreating}
        />
      </div>

      {error && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon size={12} />}
          Create identity provider
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
// FormField (internal)
// ---------------------------------------------------------------------------

function FormField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <div className="stg:space-y-1">
      <label htmlFor={id} className="stg:text-xs stg:font-medium stg:text-foreground">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={cn(
          "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
          "stg:placeholder:text-muted-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
      />
      {hint && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
