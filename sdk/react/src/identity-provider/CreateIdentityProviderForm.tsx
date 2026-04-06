"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { useCreateIdentityProvider } from "./useCreateIdentityProvider";

/** Props for {@link CreateIdentityProviderForm}. */
export interface CreateIdentityProviderFormProps {
  /** Organization slug — the IdP will be created in this org. */
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
 * **OIDC client ID**.
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
  const { create, isCreating, error, clearError } =
    useCreateIdentityProvider();

  const [name, setName] = useState("");
  const [jwksUri, setJwksUri] = useState("");
  const [issuers, setIssuers] = useState("");
  const [audience, setAudience] = useState("");
  const [isSso, setIsSso] = useState(false);
  const [oidcClientId, setOidcClientId] = useState("");

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
      create,
      clearError,
      onCreated,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-3", className)}>
      <div className="space-y-3">
        <FormField
          id="stgm-idp-name"
          label="Name"
          value={name}
          onChange={setName}
          placeholder="e.g. Acme Corp SSO"
          disabled={isCreating}
          required
        />

        <FormField
          id="stgm-idp-jwks"
          label="JWKS URI"
          value={jwksUri}
          onChange={setJwksUri}
          placeholder="https://example.com/.well-known/jwks.json"
          disabled={isCreating}
          required
        />

        <FormField
          id="stgm-idp-issuers"
          label="Allowed issuers"
          value={issuers}
          onChange={setIssuers}
          placeholder="issuer-1, issuer-2"
          hint="Comma-separated list of trusted JWT issuer values"
          disabled={isCreating}
          required
        />

        <FormField
          id="stgm-idp-audience"
          label="Expected audience"
          value={audience}
          onChange={setAudience}
          placeholder="stigmer-api"
          disabled={isCreating}
          required
        />

        {/* SSO toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={isSso}
            onClick={() => setIsSso((v) => !v)}
            disabled={isCreating}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
              isSso ? "bg-primary" : "bg-muted",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
                isSso ? "translate-x-4" : "translate-x-0",
              )}
            />
          </button>
          <span className="text-xs font-medium text-foreground">
            SSO provider
          </span>
        </div>

        {isSso && (
          <FormField
            id="stgm-idp-client-id"
            label="OIDC client ID"
            value={oidcClientId}
            onChange={setOidcClientId}
            placeholder="public-client-id"
            hint="Client ID for the PKCE-based Authorization Code flow"
            disabled={isCreating}
            required
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
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon />}
          Create identity provider
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
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
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-foreground">
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
          "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      />
      {hint && (
        <p className="text-[0.65rem] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

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
