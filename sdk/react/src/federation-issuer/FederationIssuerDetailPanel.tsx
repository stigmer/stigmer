"use client";

import { type FormEvent, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { buildFederationIssuerProto } from "@stigmer/client";
import { maskedEdit, saveErrorMessage } from "@stigmer/react-core/internal";
import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { EXPECTED_AUDIENCE_HINT, EXPECTED_AUDIENCE_PLACEHOLDER } from "./copy.js";
import {
  formatSignInRole,
  SignInSettingsSection,
  signInSettingsFromSpec,
  toSignInInput,
  type SignInSettings,
} from "./SignInSettings.js";
import { useUpdateFederationIssuer } from "./useUpdateFederationIssuer.js";
import { PermissionGate } from "../grant/PermissionGate.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { ResourceSlugField } from "../resource-detail/RenameSlugField.js";

/** Props for {@link FederationIssuerDetailPanel}. */
export interface FederationIssuerDetailPanelProps {
  /** The federation issuer resource to display and edit. */
  readonly federationIssuer: FederationIssuer;
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (issuer: FederationIssuer) => void;
  /** Fired when the user clicks the back button. */
  readonly onBack?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * View and edit panel for an existing federation issuer: the
 * organization's trust in tokens another platform issues.
 *
 * In **view mode**, displays all OIDC configuration fields in a
 * structured label/value layout, with an "Edit" button for a caller who
 * may edit the issuer (`can_edit`).
 *
 * In **edit mode**, fields become editable inputs, the sign-in settings
 * (account creation, sign-in role, customer id claim) among them. "Save" submits the update via
 * {@link useUpdateFederationIssuer}; "Cancel" discards changes and
 * returns to view mode.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <FederationIssuerDetailPanel
 *   federationIssuer={issuer}
 *   onUpdated={(updated) => refetch()}
 *   onBack={() => setFlow({ phase: "idle" })}
 * />
 * ```
 */
export function FederationIssuerDetailPanel({
  federationIssuer,
  onUpdated,
  onBack,
  className,
}: FederationIssuerDetailPanelProps) {
  const baseId = useId();
  const spec = federationIssuer.spec;
  const meta = federationIssuer.metadata;

  const { update, isUpdating, error, clearError } =
    useUpdateFederationIssuer();
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

  const [signIn, setSignIn] = useState<SignInSettings>(() => signInSettingsFromSpec(spec));

  const enterEdit = useCallback(() => {
    setDisplayName(spec?.displayName ?? "");
    setJwksUri(spec?.jwksUri ?? "");
    setIssuers(spec?.allowedIssuers.join(", ") ?? "");
    setAudience(spec?.expectedAudience ?? "");
    setUserinfoEndpoint(spec?.userinfoEndpoint ?? "");
    setSignIn(signInSettingsFromSpec(spec));
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
        // The update names the fields this form edits, so a spec field the
        // form does not list keeps its stored value. Fields the form clears
        // (an emptied userinfo endpoint or sign-in setting) are named with
        // undefined, which clears them.
        const { resource, paths } = maskedEdit(federationIssuer, buildFederationIssuerProto, {
          displayName: displayName.trim(),
          jwksUri: jwksUri.trim(),
          allowedIssuers: issuers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          expectedAudience: audience.trim(),
          userinfoEndpoint: userinfoEndpoint.trim() || undefined,
          ...toSignInInput(signIn),
        });
        const updated = await update(resource, paths);
        setMode("view");
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateFederationIssuer
      }
    },
    [
      federationIssuer, displayName, jwksUri, issuers, audience,
      userinfoEndpoint, signIn, update, clearError,
      onUpdated,
    ],
  );

  const canSave =
    displayName.trim() !== "" &&
    jwksUri.trim() !== "" &&
    issuers.trim() !== "" &&
    audience.trim() !== "" &&
    !isUpdating;

  const createdAt = federationIssuer.status?.audit?.specAudit?.createdAt;
  const updatedAt = federationIssuer.status?.audit?.specAudit?.updatedAt;

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
            {spec?.displayName || meta?.name || "Federation Issuer"}
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
            resource={{ kind: "federation_issuer", id: meta?.id ?? "" }}
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

      {/* Rename: for whoever may delete the issuer. Sign-in does not
          name its slug, so the people it signs in keep signing in. */}
      {mode === "view" && (
        <ResourceSlugField
          kind="federation_issuer"
          resourceId={meta?.id || null}
          currentSlug={meta?.slug ?? ""}
          onRenamed={(renamed) => onUpdated?.(renamed as FederationIssuer)}
          className="stg:max-w-md"
        />
      )}

      {/* Body */}
      {mode === "view" ? (
        <ViewMode
          spec={spec}
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
            placeholder="e.g., Acme Platform"
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

          <SignInSettingsSection
            value={signIn}
            onChange={setSignIn}
            disabled={isUpdating}
          />

          {error && (
            <p className="stg:text-destructive stg:text-2xs" role="alert">
              {saveErrorMessage(error, "federation issuer")}
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
  createdAt,
  updatedAt,
}: {
  spec: FederationIssuer["spec"];
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
          {spec.externalIdClaim && (
            <Field
              label="Customer id claim"
              value={spec.externalIdClaim}
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
      <dt className="stg:text-muted-foreground stg:text-2xs stg:font-medium">
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
        <p className="stg:text-2xs stg:text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provisioning mode badge
// ---------------------------------------------------------------------------

function ProvisioningModeBadge({ spec }: { spec: FederationIssuer["spec"] }) {
  if (spec?.createAccountsOnSignIn) {
    return (
      <span className="stg:inline-flex stg:items-center stg:rounded-full stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-2 stg:py-0.5 stg:text-2xs stg:font-medium stg:text-primary">
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

