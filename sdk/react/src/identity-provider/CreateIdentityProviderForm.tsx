"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { useCreateIdentityProvider } from "./useCreateIdentityProvider.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

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

  // JIT provisioning
  const [autoProvision, setAutoProvision] = useState(false);
  const [autoGrant, setAutoGrant] = useState(false);
  const [autoGrantRole, setAutoGrantRole] = useState<IamRole>(IamRole.iam_role_unspecified);
  const [tenantOrgClaim, setTenantOrgClaim] = useState("");

  const handleAutoProvisionChange = useCallback((v: boolean) => {
    setAutoProvision(v);
    if (!v) {
      setAutoGrant(false);
      setAutoGrantRole(IamRole.iam_role_unspecified);
      setTenantOrgClaim("");
    }
  }, []);

  const handleAutoGrantChange = useCallback((v: boolean) => {
    setAutoGrant(v);
    if (v) setAutoProvision(true);
    if (!v) {
      setAutoGrantRole(IamRole.iam_role_unspecified);
      setTenantOrgClaim("");
    }
  }, []);

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
          ...(!isSso && {
            autoProvisionAccounts: autoProvision,
            autoGrantOnOrg: autoGrant,
            ...(autoGrant && autoGrantRole !== IamRole.iam_role_unspecified && {
              autoGrantRole,
            }),
            ...(autoGrant && tenantOrgClaim.trim() && {
              tenantOrgClaim: tenantOrgClaim.trim(),
            }),
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
      autoProvision,
      autoGrant,
      autoGrantRole,
      tenantOrgClaim,
      create,
      clearError,
      onCreated,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
      <div className="stg:space-y-3">
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
        <div className="stg:flex stg:items-center stg:gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={isSso}
            onClick={() => setIsSso((v) => !v)}
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

        {/* JIT provisioning */}
        <JitSection
          isSso={isSso}
          autoProvision={autoProvision}
          onAutoProvisionChange={handleAutoProvisionChange}
          autoGrant={autoGrant}
          onAutoGrantChange={handleAutoGrantChange}
          autoGrantRole={autoGrantRole}
          onAutoGrantRoleChange={setAutoGrantRole}
          tenantOrgClaim={tenantOrgClaim}
          onTenantOrgClaimChange={setTenantOrgClaim}
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

// ---------------------------------------------------------------------------
// JIT provisioning section
// ---------------------------------------------------------------------------

const JIT_ROLE_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: String(IamRole.iam_role_unspecified), label: "Default (viewer)" },
  { value: String(IamRole.viewer), label: "Viewer" },
  { value: String(IamRole.member), label: "Member" },
  { value: String(IamRole.admin), label: "Admin" },
];

function JitSection({
  isSso,
  autoProvision,
  onAutoProvisionChange,
  autoGrant,
  onAutoGrantChange,
  autoGrantRole,
  onAutoGrantRoleChange,
  tenantOrgClaim,
  onTenantOrgClaimChange,
  disabled,
}: {
  isSso: boolean;
  autoProvision: boolean;
  onAutoProvisionChange: (v: boolean) => void;
  autoGrant: boolean;
  onAutoGrantChange: (v: boolean) => void;
  autoGrantRole: IamRole;
  onAutoGrantRoleChange: (v: IamRole) => void;
  tenantOrgClaim: string;
  onTenantOrgClaimChange: (v: string) => void;
  disabled: boolean;
}) {
  if (isSso) {
    return (
      <div className="stg:rounded-md stg:border stg:border-border-muted stg:bg-muted-faint stg:px-3 stg:py-2">
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          SSO providers automatically provision accounts and grant the{" "}
          <span className="stg:font-medium stg:text-foreground">viewer</span> role on
          the owning organization. JIT provisioning settings are not applicable.
        </p>
      </div>
    );
  }

  return (
    <fieldset className="stg:space-y-2.5" disabled={disabled}>
      <hr className="stg:border-border-muted" />
      <legend className="stg:text-xs stg:font-medium stg:text-foreground">
        JIT provisioning
      </legend>
      <p className="stg:text-[0.65rem] stg:text-muted-foreground">
        Configure automatic account creation and role assignment for users
        authenticating with this provider.
      </p>

      <ToggleSwitch
        checked={autoProvision}
        onChange={onAutoProvisionChange}
        label="Auto-provision accounts"
        hint="Create a federated account automatically on first authentication"
        disabled={disabled}
      />

      <ToggleSwitch
        checked={autoGrant}
        onChange={onAutoGrantChange}
        label="Auto-grant on organization"
        hint="Grant a role on the owning organization when an account is provisioned"
        disabled={disabled || !autoProvision}
      />

      {autoGrant && (
        <>
          <div className="stg:space-y-1">
            <label
              htmlFor="stgm-idp-grant-role"
              className="stg:text-xs stg:font-medium stg:text-foreground"
            >
              Auto-grant role
            </label>
            <select
              id="stgm-idp-grant-role"
              value={String(autoGrantRole)}
              onChange={(e) => onAutoGrantRoleChange(Number(e.target.value) as IamRole)}
              disabled={disabled}
              className={cn(
                "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
                "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              )}
            >
              {JIT_ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="stg:text-[0.65rem] stg:text-muted-foreground">
              Role granted automatically — org admins can upgrade later
            </p>
          </div>

          <FormField
            id="stgm-idp-tenant-claim"
            label="Tenant org claim"
            value={tenantOrgClaim}
            onChange={onTenantOrgClaimChange}
            placeholder="e.g., org_id"
            hint="JWT claim name that maps to a platform-managed organization (max 256 chars)"
            disabled={disabled}
          />
        </>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="stg:space-y-0.5">
      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          disabled={disabled}
          className={cn(
            "stg:relative stg:inline-flex stg:h-5 stg:w-9 stg:shrink-0 stg:cursor-pointer stg:rounded-full stg:border-2 stg:border-transparent stg:transition-colors",
            checked ? "stg:bg-primary" : "stg:bg-muted",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          <span
            className={cn(
              "stg:pointer-events-none stg:inline-block stg:h-4 stg:w-4 stg:rounded-full stg:bg-background stg:shadow-sm stg:ring-0 stg:transition-transform",
              checked ? "stg:translate-x-4" : "stg:translate-x-0",
            )}
          />
        </button>
        <span className="stg:text-xs stg:font-medium stg:text-foreground">{label}</span>
      </div>
      {hint && (
        <p className="stg:pl-11 stg:text-[0.65rem] stg:text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

