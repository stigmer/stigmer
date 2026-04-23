"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { useUpdateIdentityProvider } from "./useUpdateIdentityProvider";

/** Props for {@link IdentityProviderDetailPanel}. */
export interface IdentityProviderDetailPanelProps {
  /** The identity provider resource to display and edit. */
  readonly identityProvider: IdentityProvider;
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (idp: IdentityProvider) => void;
  /** Fired when the user clicks the back button. */
  readonly onBack?: () => void;
  /**
   * Pre-computed SSO login URL to display when the IdP is an SSO provider.
   * Omit to hide the field. The consumer is responsible for constructing
   * the URL (e.g., `${window.location.origin}/login?org=${orgSlug}`).
   */
  readonly ssoLoginUrl?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * View and edit panel for an existing identity provider.
 *
 * In **view mode**, displays all OIDC configuration fields in a
 * structured label/value layout with an "Edit" button.
 *
 * In **edit mode**, fields become editable inputs. The SSO toggle and
 * OIDC client ID are editable. "Save" submits the update via
 * {@link useUpdateIdentityProvider}; "Cancel" discards changes and
 * returns to view mode.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <IdentityProviderDetailPanel
 *   identityProvider={idp}
 *   onUpdated={(updated) => refetch()}
 *   onBack={() => setFlow({ phase: "idle" })}
 * />
 * ```
 */
export function IdentityProviderDetailPanel({
  identityProvider,
  onUpdated,
  onBack,
  ssoLoginUrl,
  className,
}: IdentityProviderDetailPanelProps) {
  const spec = identityProvider.spec;
  const meta = identityProvider.metadata;

  const { update, isUpdating, error, clearError } =
    useUpdateIdentityProvider();
  const [mode, setMode] = useState<"view" | "edit">("view");

  // Edit form state — initialized from current resource
  const [displayName, setDisplayName] = useState(spec?.displayName ?? "");
  const [jwksUri, setJwksUri] = useState(spec?.jwksUri ?? "");
  const [issuers, setIssuers] = useState(
    spec?.allowedIssuers.join(", ") ?? "",
  );
  const [audience, setAudience] = useState(spec?.expectedAudience ?? "");
  const [userinfoEndpoint, setUserinfoEndpoint] = useState(
    spec?.userinfoEndpoint ?? "",
  );
  const [isSso, setIsSso] = useState(spec?.isSsoProvider ?? false);
  const [oidcClientId, setOidcClientId] = useState(
    spec?.oidcClientId ?? "",
  );

  // JIT provisioning
  const [autoProvision, setAutoProvision] = useState(spec?.autoProvisionAccounts ?? false);
  const [autoGrant, setAutoGrant] = useState(spec?.autoGrantOnOrg ?? false);
  const [autoGrantRole, setAutoGrantRole] = useState<IamRole>(spec?.autoGrantRole ?? IamRole.iam_role_unspecified);
  const [tenantOrgClaim, setTenantOrgClaim] = useState(spec?.tenantOrgClaim ?? "");

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

  const enterEdit = useCallback(() => {
    setDisplayName(spec?.displayName ?? "");
    setJwksUri(spec?.jwksUri ?? "");
    setIssuers(spec?.allowedIssuers.join(", ") ?? "");
    setAudience(spec?.expectedAudience ?? "");
    setUserinfoEndpoint(spec?.userinfoEndpoint ?? "");
    setIsSso(spec?.isSsoProvider ?? false);
    setOidcClientId(spec?.oidcClientId ?? "");
    setAutoProvision(spec?.autoProvisionAccounts ?? false);
    setAutoGrant(spec?.autoGrantOnOrg ?? false);
    setAutoGrantRole(spec?.autoGrantRole ?? IamRole.iam_role_unspecified);
    setTenantOrgClaim(spec?.tenantOrgClaim ?? "");
    clearError();
    setMode("edit");
  }, [spec, clearError]);

  const cancelEdit = useCallback(() => {
    clearError();
    setMode("view");
  }, [clearError]);

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      clearError();
      try {
        const updated = await update({
          name: meta?.name ?? "",
          slug: meta?.slug,
          org: meta?.org ?? "",
          displayName: displayName.trim(),
          jwksUri: jwksUri.trim(),
          allowedIssuers: issuers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          expectedAudience: audience.trim(),
          userinfoEndpoint: userinfoEndpoint.trim() || undefined,
          isSsoProvider: isSso,
          oidcClientId: isSso ? oidcClientId.trim() : undefined,
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
        setMode("view");
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateIdentityProvider
      }
    },
    [
      meta, displayName, jwksUri, issuers, audience,
      userinfoEndpoint, isSso, oidcClientId, autoProvision, autoGrant,
      autoGrantRole, tenantOrgClaim, update, clearError, onUpdated,
    ],
  );

  const canSave =
    displayName.trim() !== "" &&
    jwksUri.trim() !== "" &&
    issuers.trim() !== "" &&
    audience.trim() !== "" &&
    (!isSso || oidcClientId.trim() !== "") &&
    !isUpdating;

  const createdAt = identityProvider.status?.audit?.specAudit?.createdAt;
  const updatedAt = identityProvider.status?.audit?.specAudit?.updatedAt;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground mb-1 flex items-center gap-1 text-xs transition-colors"
            >
              <ArrowLeftIcon />
              Back to list
            </button>
          )}
          <h3 className="text-foreground truncate text-sm font-semibold">
            {spec?.displayName || meta?.name || "Identity Provider"}
          </h3>
          <div className="flex items-center gap-2">
            {meta?.slug && (
              <span className="text-muted-foreground font-mono text-xs">
                {meta.slug}
              </span>
            )}
            <ProvisioningModeBadge spec={spec} />
          </div>
        </div>

        {mode === "view" && (
          <button
            type="button"
            onClick={enterEdit}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "transition-colors",
            )}
          >
            Edit
          </button>
        )}
      </div>

      {/* Body */}
      {mode === "view" ? (
        <ViewMode
          spec={spec}
          ssoLoginUrl={ssoLoginUrl}
          createdAt={createdAt}
          updatedAt={updatedAt}
        />
      ) : (
        <form onSubmit={handleSave} className="space-y-3">
          <FieldInput
            id="stgm-idp-edit-name"
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            placeholder="e.g., Acme Corp SSO"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id="stgm-idp-edit-jwks"
            label="JWKS URI"
            value={jwksUri}
            onChange={setJwksUri}
            placeholder="https://example.com/.well-known/jwks.json"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id="stgm-idp-edit-issuers"
            label="Allowed issuers"
            value={issuers}
            onChange={setIssuers}
            placeholder="https://issuer.example.com/"
            hint="Comma-separated list of trusted JWT issuer values"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id="stgm-idp-edit-audience"
            label="Expected audience"
            value={audience}
            onChange={setAudience}
            placeholder="stigmer-api"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id="stgm-idp-edit-userinfo"
            label="Userinfo endpoint"
            value={userinfoEndpoint}
            onChange={setUserinfoEndpoint}
            placeholder="https://example.com/userinfo"
            hint="Optional — used to fetch user profile data"
            disabled={isUpdating}
          />

          {/* SSO toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={isSso}
              onClick={() => setIsSso((v) => !v)}
              disabled={isUpdating}
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
            <FieldInput
              id="stgm-idp-edit-client-id"
              label="OIDC client ID"
              value={oidcClientId}
              onChange={setOidcClientId}
              placeholder="public-client-id"
              hint="Client ID for the PKCE-based Authorization Code flow"
              disabled={isUpdating}
              required
            />
          )}

          {/* JIT provisioning */}
          <JitEditSection
            isSso={isSso}
            autoProvision={autoProvision}
            onAutoProvisionChange={handleAutoProvisionChange}
            autoGrant={autoGrant}
            onAutoGrantChange={handleAutoGrantChange}
            autoGrantRole={autoGrantRole}
            onAutoGrantRoleChange={setAutoGrantRole}
            tenantOrgClaim={tenantOrgClaim}
            onTenantOrgClaimChange={setTenantOrgClaim}
            disabled={isUpdating}
          />

          {error && (
            <p className="text-destructive text-[0.65rem]" role="alert">
              {getUserMessage(error)}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
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
              Save changes
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={isUpdating}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs",
                "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View mode
// ---------------------------------------------------------------------------

function ViewMode({
  spec,
  ssoLoginUrl,
  createdAt,
  updatedAt,
}: {
  spec: IdentityProvider["spec"];
  ssoLoginUrl?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}) {
  return (
    <dl className="space-y-2.5">
      <Field label="JWKS URI" value={spec?.jwksUri} mono />
      <Field
        label="Allowed issuers"
        value={spec?.allowedIssuers.join(", ")}
        mono
      />
      <Field label="Expected audience" value={spec?.expectedAudience} mono />
      {spec?.userinfoEndpoint && (
        <Field label="Userinfo endpoint" value={spec.userinfoEndpoint} mono />
      )}
      {spec?.isSsoProvider && (
        <Field label="OIDC client ID" value={spec.oidcClientId} mono />
      )}
      {spec?.isSsoProvider && ssoLoginUrl && (
        <CopyableField
          label="SSO login URL"
          value={ssoLoginUrl}
          hint="Share this URL with your team members to sign in via SSO"
        />
      )}
      {(spec?.rateLimitBudget ?? 0) > 0 && (
        <Field
          label="Rate limit"
          value={`${spec!.rateLimitBudget} req/min`}
        />
      )}

      {/* JIT provisioning fields */}
      {!spec?.isSsoProvider && spec?.autoProvisionAccounts && (
        <>
          <hr className="border-border-muted" />
          <Field
            label="Auto-provision accounts"
            value={spec.autoProvisionAccounts ? "Enabled" : "Disabled"}
          />
          <Field
            label="Auto-grant on organization"
            value={spec.autoGrantOnOrg ? "Enabled" : "Disabled"}
          />
          {spec.autoGrantOnOrg && (
            <Field
              label="Auto-grant role"
              value={formatIamRole(spec.autoGrantRole)}
            />
          )}
          {spec.autoGrantOnOrg && spec.tenantOrgClaim && (
            <Field
              label="Tenant org claim"
              value={spec.tenantOrgClaim}
              mono
            />
          )}
        </>
      )}

      <div className="flex gap-6">
        {createdAt && (
          <Field
            label="Created"
            value={formatDate(timestampDate(createdAt))}
          />
        )}
        {updatedAt && (
          <Field
            label="Updated"
            value={formatDate(timestampDate(updatedAt))}
          />
        )}
      </div>
    </dl>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-muted-foreground text-[0.65rem] font-medium">
        {label}
      </dt>
      <dd
        className={cn(
          "text-foreground mt-0.5 break-all text-xs",
          mono && "font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View mode — copyable field
// ---------------------------------------------------------------------------

const COPIED_FEEDBACK_MS = 2000;

function CopyableField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  const valueId = "stgm-idp-sso-login-url";

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      const el = document.getElementById(valueId);
      if (el) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }, [value]);

  return (
    <div>
      <dt className="text-muted-foreground text-[0.65rem] font-medium">
        {label}
      </dt>
      <dd className="mt-0.5">
        <div className="flex items-center gap-2">
          <span
            id={valueId}
            className="text-foreground break-all font-mono text-xs select-all"
          >
            {value}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[0.6rem]",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "transition-colors",
            )}
            aria-label={`Copy ${label}`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {hint && (
          <p className="text-muted-foreground mt-0.5 text-[0.65rem]">
            {hint}
          </p>
        )}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {copied && "SSO login URL copied to clipboard"}
        </div>
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function FieldInput({
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
  disabled?: boolean;
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
// Provisioning mode badge
// ---------------------------------------------------------------------------

function ProvisioningModeBadge({ spec }: { spec: IdentityProvider["spec"] }) {
  if (spec?.isSsoProvider) {
    return (
      <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary-subtle px-2 py-0.5 text-[0.65rem] font-medium text-primary">
        SSO
      </span>
    );
  }
  if (spec?.autoProvisionAccounts) {
    return (
      <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary-subtle px-2 py-0.5 text-[0.65rem] font-medium text-primary">
        JIT
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// JIT edit section
// ---------------------------------------------------------------------------

const JIT_ROLE_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: String(IamRole.iam_role_unspecified), label: "Default (viewer)" },
  { value: String(IamRole.viewer), label: "Viewer" },
  { value: String(IamRole.member), label: "Member" },
  { value: String(IamRole.admin), label: "Admin" },
];

function JitEditSection({
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
  disabled?: boolean;
}) {
  if (isSso) {
    return (
      <div className="rounded-md border border-border-muted bg-muted-faint px-3 py-2">
        <p className="text-[0.65rem] text-muted-foreground">
          SSO providers automatically provision accounts and grant the{" "}
          <span className="font-medium text-foreground">viewer</span> role on
          the owning organization. JIT provisioning settings are not applicable.
        </p>
      </div>
    );
  }

  return (
    <fieldset className="space-y-2.5" disabled={disabled}>
      <hr className="border-border-muted" />
      <legend className="text-xs font-medium text-foreground">
        JIT provisioning
      </legend>
      <p className="text-[0.65rem] text-muted-foreground">
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
          <div className="space-y-1">
            <label
              htmlFor="stgm-idp-edit-grant-role"
              className="text-xs font-medium text-foreground"
            >
              Auto-grant role
            </label>
            <select
              id="stgm-idp-edit-grant-role"
              value={String(autoGrantRole)}
              onChange={(e) => onAutoGrantRoleChange(Number(e.target.value) as IamRole)}
              disabled={disabled}
              className={cn(
                "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {JIT_ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[0.65rem] text-muted-foreground">
              Role granted automatically — org admins can upgrade later
            </p>
          </div>

          <FieldInput
            id="stgm-idp-edit-tenant-claim"
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
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          disabled={disabled}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            checked ? "bg-primary" : "bg-muted",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
              checked ? "translate-x-4" : "translate-x-0",
            )}
          />
        </button>
        <span className="text-xs font-medium text-foreground">{label}</span>
      </div>
      {hint && (
        <p className="pl-11 text-[0.65rem] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatIamRole(role: IamRole): string {
  switch (role) {
    case IamRole.viewer: return "Viewer";
    case IamRole.member: return "Member";
    case IamRole.admin: return "Admin";
    case IamRole.owner: return "Owner";
    default: return "Viewer (default)";
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ArrowLeftIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3L5 8l5 5" />
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
