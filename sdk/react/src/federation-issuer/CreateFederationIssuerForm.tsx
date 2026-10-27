"use client";

import { type FormEvent, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { EXPECTED_AUDIENCE_HINT, EXPECTED_AUDIENCE_PLACEHOLDER } from "./copy.js";
import {
  EMPTY_SIGN_IN_SETTINGS,
  SignInSettingsSection,
  toSignInInput,
  type SignInSettings,
} from "./SignInSettings.js";
import { useCreateFederationIssuer } from "./useCreateFederationIssuer.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link CreateFederationIssuerForm}. */
export interface CreateFederationIssuerFormProps {
  /** Organization id — the IdP will be created in this org (a slug is also accepted). */
  readonly org: string;
  /** Fired with the newly created federation issuer on success. */
  readonly onCreated?: (issuer: FederationIssuer) => void;
  /** Fired when the user cancels creation. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Form for creating a new federation issuer within an organization: the
 * organization's trust in tokens another platform issues.
 *
 * Collects the required OIDC trust configuration: **name** (display
 * name), **JWKS URI**, **allowed issuers**, and **expected audience**,
 * and sets what a sign-in does: whether it creates the person's account,
 * the role granted on their first sign-in to the organization, and the
 * claim that binds a token to an organization.
 *
 * On success it fires `onCreated` with the full {@link FederationIssuer}
 * response.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <CreateFederationIssuerForm
 *   org="acme"
 *   onCreated={(issuer) => {
 *     refetch();
 *     setShowForm(false);
 *   }}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function CreateFederationIssuerForm({
  org,
  onCreated,
  onCancel,
  className,
}: CreateFederationIssuerFormProps) {
  const baseId = useId();
  const { create, isCreating, error, clearError } =
    useCreateFederationIssuer();

  const [name, setName] = useState("");
  const [jwksUri, setJwksUri] = useState("");
  const [issuers, setIssuers] = useState("");
  const [audience, setAudience] = useState("");

  const [signIn, setSignIn] = useState<SignInSettings>(EMPTY_SIGN_IN_SETTINGS);

  const trimmedName = name.trim();
  const trimmedJwksUri = jwksUri.trim();
  const trimmedIssuers = issuers.trim();
  const trimmedAudience = audience.trim();
  const canSubmit =
    trimmedName !== "" &&
    trimmedJwksUri !== "" &&
    trimmedIssuers !== "" &&
    trimmedAudience !== "" &&
    !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const issuer = await create({
          name: trimmedName,
          org,
          jwksUri: trimmedJwksUri,
          allowedIssuers: trimmedIssuers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          expectedAudience: trimmedAudience,
          ...toSignInInput(signIn),
        });
        onCreated?.(issuer);
      } catch {
        // error state is managed by useCreateFederationIssuer
      }
    },
    [
      canSubmit,
      trimmedName,
      org,
      trimmedJwksUri,
      trimmedIssuers,
      trimmedAudience,
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
          placeholder="e.g. Acme Platform"
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

        <SignInSettingsSection
          value={signIn}
          onChange={setSignIn}
          disabled={isCreating}
        />
      </div>

      {error && (
        <p className="stg:text-destructive stg:text-2xs" role="alert">
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
          Create federation issuer
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
        <p className="stg:text-2xs stg:text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
