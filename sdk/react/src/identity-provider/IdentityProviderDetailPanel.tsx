"use client";

import { type FormEvent, useCallback, useId, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, toIdentityProviderUpdateInput } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { EXPECTED_AUDIENCE_HINT, EXPECTED_AUDIENCE_PLACEHOLDER } from "./copy.js";
import {
  formatSignInRole,
  SignInSettingsSection,
  signInSettingsComplete,
  signInSettingsFromSpec,
  toSignInInput,
  useSignInSettings,
} from "./SignInSettings.js";
import { useUpdateIdentityProvider } from "./useUpdateIdentityProvider.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { selectElementText } from "../internal/select-element-text.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";

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
   * the URL (e.g., `${window.location.origin}/login?org=${orgId}`), naming
   * the organization by its permanent id so a later holder of its slug
   * can never put their own sign-in behind the link. The login page
   * accepts a typed slug too.
   */
  readonly ssoLoginUrl?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * View and edit panel for an existing identity provider.
 *
 * In **view mode**, displays all OIDC configuration fields in a
 * structured label/value layout, with an "Edit" button for a caller who
 * may edit the provider (`can_edit`).
 *
 * In **edit mode**, fields become editable inputs. The SSO toggle,
 * OIDC client ID and sign-in settings (account creation, sign-in role,
 * tenant org claim) are editable. "Save" submits the update via
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
  const baseId = useId();
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

  const { signIn, setSignIn, switchSso, reset } = useSignInSettings(() =>
    signInSettingsFromSpec(spec),
  );

  const handleSsoToggle = useCallback(() => {
    const next = !isSso;
    setIsSso(next);
    switchSso(next);
  }, [isSso, switchSso]);

  const enterEdit = useCallback(() => {
    setDisplayName(spec?.displayName ?? "");
    setJwksUri(spec?.jwksUri ?? "");
    setIssuers(spec?.allowedIssuers.join(", ") ?? "");
    setAudience(spec?.expectedAudience ?? "");
    setUserinfoEndpoint(spec?.userinfoEndpoint ?? "");
    setIsSso(spec?.isSsoProvider ?? false);
    setOidcClientId(spec?.oidcClientId ?? "");
    reset(signInSettingsFromSpec(spec));
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
        // Full-spec-replace safety: spread the complete mapped input and
        // override only the edited fields, so a spec field the form does
        // not list survives the save. Fields the form clears (the client
        // id of a provider that is no longer SSO, an emptied sign-in
        // setting) are set to undefined explicitly — omitting them would
        // carry the stale mapped value.
        const updated = await update({
          ...toIdentityProviderUpdateInput(identityProvider),
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
          ...toSignInInput(signIn, isSso),
        });
        setMode("view");
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateIdentityProvider
      }
    },
    [
      identityProvider, displayName, jwksUri, issuers, audience,
      userinfoEndpoint, isSso, oidcClientId, signIn, update, clearError,
      onUpdated,
    ],
  );

  const canSave =
    displayName.trim() !== "" &&
    jwksUri.trim() !== "" &&
    issuers.trim() !== "" &&
    audience.trim() !== "" &&
    (!isSso || oidcClientId.trim() !== "") &&
    signInSettingsComplete(signIn, isSso) &&
    !isUpdating;

  const createdAt = identityProvider.status?.audit?.specAudit?.createdAt;
  const updatedAt = identityProvider.status?.audit?.specAudit?.updatedAt;

  return (
    <div className={cn("stg:space-y-4", className)}>
      {/* Header */}
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="stg:text-muted-foreground stg:hover:text-foreground stg:mb-1 stg:flex stg:items-center stg:gap-1 stg:text-xs stg:transition-colors"
            >
              <ArrowLeftIcon />
              Back to list
            </button>
          )}
          <h3 className="stg:text-foreground stg:truncate stg:text-sm stg:font-semibold">
            {spec?.displayName || meta?.name || "Identity Provider"}
          </h3>
          <div className="stg:flex stg:items-center stg:gap-2">
            {meta?.slug && (
              <span className="stg:text-muted-foreground stg:font-mono stg:text-xs">
                {meta.slug}
              </span>
            )}
            <ProvisioningModeBadge spec={spec} />
          </div>
        </div>

        {mode === "view" && (
          <PermissionGate
            resource={{ kind: "identity_provider", id: meta?.id ?? "" }}
            relation="can_edit"
          >
            <button
              type="button"
              onClick={enterEdit}
              className={cn(
                "stg:shrink-0 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
                "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
                "stg:transition-colors",
              )}
            >
              Edit
            </button>
          </PermissionGate>
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
        <form onSubmit={handleSave} className="stg:space-y-3">
          <FieldInput
            id={`${baseId}-name`}
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            placeholder="e.g., Acme Corp SSO"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id={`${baseId}-jwks`}
            label="JWKS URI"
            value={jwksUri}
            onChange={setJwksUri}
            placeholder="https://example.com/.well-known/jwks.json"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id={`${baseId}-issuers`}
            label="Allowed issuers"
            value={issuers}
            onChange={setIssuers}
            placeholder="https://issuer.example.com/"
            hint="Comma-separated list of trusted JWT issuer values"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id={`${baseId}-audience`}
            label="Expected audience"
            value={audience}
            onChange={setAudience}
            placeholder={EXPECTED_AUDIENCE_PLACEHOLDER}
            hint={EXPECTED_AUDIENCE_HINT}
            disabled={isUpdating}
            required
          />
          <FieldInput
            id={`${baseId}-userinfo`}
            label="Userinfo endpoint"
            value={userinfoEndpoint}
            onChange={setUserinfoEndpoint}
            placeholder="https://example.com/userinfo"
            hint="Optional. Read only when Stigmer creates an account from a token with no email claim"
            disabled={isUpdating}
          />

          {/* SSO toggle */}
          <div className="stg:flex stg:items-center stg:gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={isSso}
              onClick={handleSsoToggle}
              disabled={isUpdating}
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
            <FieldInput
              id={`${baseId}-client-id`}
              label="OIDC client ID"
              value={oidcClientId}
              onChange={setOidcClientId}
              placeholder="public-client-id"
              hint="Client ID for the PKCE-based Authorization Code flow"
              disabled={isUpdating}
              required
            />
          )}

          <SignInSettingsSection
            isSso={isSso}
            value={signIn}
            onChange={setSignIn}
            disabled={isUpdating}
          />

          {error && (
            <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
              {getUserMessage(error)}
            </p>
          )}

          <div className="stg:flex stg:items-center stg:gap-2 stg:pt-1">
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
              Save changes
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={isUpdating}
              className={cn(
                "stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs",
                "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
    <dl className="stg:space-y-2.5">
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

      {/* Sign-in settings */}
      {spec && (
        <>
          <hr className="stg:border-border-muted" />
          <Field
            label="Create accounts on sign-in"
            value={spec.createAccountsOnSignIn ? "On" : "Off"}
          />
          <Field
            label="Sign-in role"
            value={formatSignInRole(spec.signInRole)}
          />
          {spec.tenantOrgClaim && (
            <Field
              label="Tenant org claim"
              value={spec.tenantOrgClaim}
              mono
            />
          )}
        </>
      )}

      <div className="stg:flex stg:gap-6">
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
      <dt className="stg:text-muted-foreground stg:text-[0.65rem] stg:font-medium">
        {label}
      </dt>
      <dd
        className={cn(
          "stg:text-foreground stg:mt-0.5 stg:break-all stg:text-xs",
          mono && "stg:font-mono",
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

function CopyableField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const { copy, copied } = useCopyFeedback();
  const revealRef = useRef<HTMLElement>(null);

  const handleCopy = useCallback(async () => {
    if (await copy(value)) return;
    // Rejected write: select the revealed value so the user can copy manually.
    if (revealRef.current) selectElementText(revealRef.current);
  }, [copy, value]);

  return (
    <div>
      <dt className="stg:text-muted-foreground stg:text-[0.65rem] stg:font-medium">
        {label}
      </dt>
      <dd className="stg:mt-0.5">
        <div className="stg:flex stg:items-center stg:gap-2">
          <span
            ref={revealRef}
            className="stg:text-foreground stg:break-all stg:font-mono stg:text-xs stg:select-all"
          >
            {value}
          </span>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className={cn(
              "stg:shrink-0 stg:rounded stg:px-1.5 stg:py-0.5 stg:text-[0.6rem]",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:transition-colors",
            )}
            aria-label={`Copy ${label}`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {hint && (
          <p className="stg:text-muted-foreground stg:mt-0.5 stg:text-[0.65rem]">
            {hint}
          </p>
        )}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="stg:sr-only"
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
// Provisioning mode badge
// ---------------------------------------------------------------------------

function ProvisioningModeBadge({ spec }: { spec: IdentityProvider["spec"] }) {
  if (spec?.isSsoProvider) {
    return (
      <span className="stg:inline-flex stg:items-center stg:rounded-full stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-primary">
        SSO
      </span>
    );
  }
  if (spec?.createAccountsOnSignIn) {
    return (
      <span className="stg:inline-flex stg:items-center stg:rounded-full stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-primary">
        JIT
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

