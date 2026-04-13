"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { useCreateOAuthApp } from "./useCreateOAuthApp";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link CreateOAuthAppForm}. */
export interface CreateOAuthAppFormProps {
  /** Organization slug — the OAuth app will be created in this org. */
  readonly org: string;
  /** Fired with the newly created OAuth app on success. */
  readonly onCreated?: (app: OAuthApp) => void;
  /** Fired when the user cancels creation. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Form for creating a new OAuth app within an organization.
 *
 * Collects the required OAuth configuration: **name**, **provider**,
 * **client ID**, **client secret**, **authorization URL**, and
 * **token URL**. An expandable "Advanced" section provides optional
 * fields for scopes, userinfo URL, scope parameter name, and vendor
 * approval settings.
 *
 * This is a pure presentational component with no dialog wrapper
 * (headless-first). The parent is responsible for rendering it inside
 * a card, dialog, or inline context as needed.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <CreateOAuthAppForm
 *   org="acme"
 *   onCreated={(app) => {
 *     refetch();
 *     setShowForm(false);
 *   }}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function CreateOAuthAppForm({
  org,
  onCreated,
  onCancel,
  className,
}: CreateOAuthAppFormProps) {
  const { create, isCreating, error, clearError } = useCreateOAuthApp();

  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scopes, setScopes] = useState("");
  const [userinfoUrl, setUserinfoUrl] = useState("");
  const [scopeParameterName, setScopeParameterName] = useState("");
  const [vendorApprovalStatus, setVendorApprovalStatus] = useState<
    "unspecified" | "pending" | "approved" | "rejected"
  >("unspecified");
  const [vendorApprovalDocsUrl, setVendorApprovalDocsUrl] = useState("");

  const trimmedName = name.trim();
  const trimmedProvider = provider.trim();
  const trimmedClientId = clientId.trim();
  const trimmedClientSecret = clientSecret.trim();
  const trimmedAuthUrl = authorizationUrl.trim();
  const trimmedTokenUrl = tokenUrl.trim();

  const canSubmit =
    trimmedName !== "" &&
    trimmedProvider !== "" &&
    trimmedClientId !== "" &&
    trimmedClientSecret !== "" &&
    trimmedAuthUrl !== "" &&
    trimmedTokenUrl !== "" &&
    !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const parsedScopes = scopes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        const app = await create({
          name: trimmedName,
          org,
          provider: trimmedProvider,
          clientId: trimmedClientId,
          clientSecret: trimmedClientSecret,
          authorizationUrl: trimmedAuthUrl,
          tokenUrl: trimmedTokenUrl,
          ...(parsedScopes.length > 0 && { scopes: parsedScopes }),
          ...(userinfoUrl.trim() && { userinfoUrl: userinfoUrl.trim() }),
          ...(scopeParameterName.trim() && {
            scopeParameterName: scopeParameterName.trim(),
          }),
          ...(vendorApprovalStatus !== "unspecified" && {
            vendorApprovalStatus: APPROVAL_STATUS_MAP[vendorApprovalStatus],
          }),
          ...(vendorApprovalDocsUrl.trim() && {
            vendorApprovalDocsUrl: vendorApprovalDocsUrl.trim(),
          }),
        });
        onCreated?.(app);
      } catch {
        // error state is managed by useCreateOAuthApp
      }
    },
    [
      canSubmit,
      trimmedName,
      org,
      trimmedProvider,
      trimmedClientId,
      trimmedClientSecret,
      trimmedAuthUrl,
      trimmedTokenUrl,
      scopes,
      userinfoUrl,
      scopeParameterName,
      vendorApprovalStatus,
      vendorApprovalDocsUrl,
      create,
      clearError,
      onCreated,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-3", className)}>
      <div className="space-y-3">
        <FormField
          id="stgm-oauth-name"
          label="Name"
          value={name}
          onChange={setName}
          placeholder="e.g. My Slack App"
          disabled={isCreating}
          required
        />

        <FormField
          id="stgm-oauth-provider"
          label="Provider"
          value={provider}
          onChange={setProvider}
          placeholder="e.g. Slack, GitHub, Salesforce"
          hint="Human-readable vendor name for display"
          disabled={isCreating}
          required
        />

        <FormField
          id="stgm-oauth-client-id"
          label="Client ID"
          value={clientId}
          onChange={setClientId}
          placeholder="OAuth client identifier"
          disabled={isCreating}
          required
        />

        <FormField
          id="stgm-oauth-client-secret"
          label="Client secret"
          value={clientSecret}
          onChange={setClientSecret}
          placeholder="OAuth client secret"
          type="password"
          disabled={isCreating}
          required
        />

        <FormField
          id="stgm-oauth-auth-url"
          label="Authorization URL"
          value={authorizationUrl}
          onChange={setAuthorizationUrl}
          placeholder="https://vendor.com/oauth/authorize"
          hint="Vendor's OAuth authorization endpoint"
          disabled={isCreating}
          required
        />

        <FormField
          id="stgm-oauth-token-url"
          label="Token URL"
          value={tokenUrl}
          onChange={setTokenUrl}
          placeholder="https://vendor.com/oauth/token"
          hint="Vendor's OAuth token exchange endpoint"
          disabled={isCreating}
          required
        />

        {/* Advanced section — collapsed by default */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[0.65rem] font-medium transition-colors"
          >
            <ChevronIcon expanded={showAdvanced} />
            Advanced settings
          </button>

          {showAdvanced && (
            <div className="mt-2 space-y-3 border-l-2 border-border/60 pl-3">
              <FormField
                id="stgm-oauth-scopes"
                label="Scopes"
                value={scopes}
                onChange={setScopes}
                placeholder="read, write, admin"
                hint="Comma-separated OAuth scopes to request"
                disabled={isCreating}
              />

              <FormField
                id="stgm-oauth-userinfo-url"
                label="Userinfo URL"
                value={userinfoUrl}
                onChange={setUserinfoUrl}
                placeholder="https://vendor.com/userinfo"
                hint="OIDC endpoint for fetching user profile data (optional)"
                disabled={isCreating}
              />

              <FormField
                id="stgm-oauth-scope-param"
                label="Scope parameter name"
                value={scopeParameterName}
                onChange={setScopeParameterName}
                placeholder="scope"
                hint='Defaults to "scope". Some vendors use a non-standard name (e.g. "user_scope" for Slack).'
                disabled={isCreating}
              />

              <div className="space-y-1">
                <label
                  htmlFor="stgm-oauth-approval-status"
                  className="text-xs font-medium text-foreground"
                >
                  Vendor approval status
                </label>
                <select
                  id="stgm-oauth-approval-status"
                  value={vendorApprovalStatus}
                  onChange={(e) =>
                    setVendorApprovalStatus(
                      e.target.value as typeof vendorApprovalStatus,
                    )
                  }
                  disabled={isCreating}
                  className={cn(
                    "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  <option value="unspecified">Unspecified (treated as approved)</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
                <p className="text-[0.65rem] text-muted-foreground">
                  Vendor marketplace approval lifecycle status
                </p>
              </div>

              <FormField
                id="stgm-oauth-approval-docs"
                label="Vendor approval docs URL"
                value={vendorApprovalDocsUrl}
                onChange={setVendorApprovalDocsUrl}
                placeholder="https://docs.example.com/byoa"
                hint="Help link shown when vendor approval is pending"
                disabled={isCreating}
              />
            </div>
          )}
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
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon />}
          Create OAuth app
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
// Constants
// ---------------------------------------------------------------------------

const APPROVAL_STATUS_MAP = {
  pending: VendorApprovalStatus.PENDING,
  approved: VendorApprovalStatus.APPROVED,
  rejected: VendorApprovalStatus.REJECTED,
} as const;

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
  type = "text",
  disabled,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  type?: "text" | "password";
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
        type={type}
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "shrink-0 transition-transform",
        expanded && "rotate-90",
      )}
    >
      <path d="M6 4l4 4-4 4" />
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
