"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { useUpdateOAuthApp } from "./useUpdateOAuthApp.js";
import { useDeleteOAuthApp } from "./useDeleteOAuthApp.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link OAuthAppDetailPanel}. */
export interface OAuthAppDetailPanelProps {
  /** The OAuth app resource to display and edit. */
  readonly oauthApp: OAuthApp;
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (app: OAuthApp) => void;
  /** Fired after the resource is successfully deleted. */
  readonly onDeleted?: () => void;
  /** Fired when the user clicks the back button. */
  readonly onBack?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * View and edit panel for an existing OAuth app.
 *
 * In **view mode**, displays all OAuth configuration fields in a
 * structured label/value layout with "Edit" and "Delete" buttons.
 *
 * In **edit mode**, fields become editable inputs. The client secret
 * field shows a placeholder — leave it empty to keep the existing
 * secret, or enter a new value to replace it. "Save" submits the
 * update via {@link useUpdateOAuthApp}; "Cancel" discards changes
 * and returns to view mode.
 *
 * Delete uses an inline confirmation pattern (no modal) to avoid
 * portal/z-index issues for SDK embedders.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <OAuthAppDetailPanel
 *   oauthApp={app}
 *   onUpdated={(updated) => refetch()}
 *   onDeleted={() => { refetch(); setFlow({ phase: "idle" }); }}
 *   onBack={() => setFlow({ phase: "idle" })}
 * />
 * ```
 */
export function OAuthAppDetailPanel({
  oauthApp,
  onUpdated,
  onDeleted,
  onBack,
  className,
}: OAuthAppDetailPanelProps) {
  const spec = oauthApp.spec;
  const meta = oauthApp.metadata;

  const { update, isUpdating, error: updateError, clearError: clearUpdateError } =
    useUpdateOAuthApp();
  const { deleteApp, isDeleting, error: deleteError, clearError: clearDeleteError } =
    useDeleteOAuthApp();

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Edit form state — initialized from current resource
  const [provider, setProvider] = useState(spec?.provider ?? "");
  const [clientId, setClientId] = useState(spec?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState(
    spec?.authorizationUrl ?? "",
  );
  const [tokenUrl, setTokenUrl] = useState(spec?.tokenUrl ?? "");
  const [scopes, setScopes] = useState(spec?.scopes.join(", ") ?? "");
  const [userinfoUrl, setUserinfoUrl] = useState(spec?.userinfoUrl ?? "");
  const [scopeParameterName, setScopeParameterName] = useState(
    spec?.scopeParameterName ?? "",
  );
  const [vendorApprovalStatus, setVendorApprovalStatus] = useState(
    approvalStatusToKey(spec?.vendorApprovalStatus),
  );
  const [vendorApprovalDocsUrl, setVendorApprovalDocsUrl] = useState(
    spec?.vendorApprovalDocsUrl ?? "",
  );

  const enterEdit = useCallback(() => {
    setProvider(spec?.provider ?? "");
    setClientId(spec?.clientId ?? "");
    setClientSecret("");
    setAuthorizationUrl(spec?.authorizationUrl ?? "");
    setTokenUrl(spec?.tokenUrl ?? "");
    setScopes(spec?.scopes.join(", ") ?? "");
    setUserinfoUrl(spec?.userinfoUrl ?? "");
    setScopeParameterName(spec?.scopeParameterName ?? "");
    setVendorApprovalStatus(approvalStatusToKey(spec?.vendorApprovalStatus));
    setVendorApprovalDocsUrl(spec?.vendorApprovalDocsUrl ?? "");
    clearUpdateError();
    setMode("edit");
  }, [spec, clearUpdateError]);

  const cancelEdit = useCallback(() => {
    clearUpdateError();
    setMode("view");
  }, [clearUpdateError]);

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      clearUpdateError();

      const parsedScopes = scopes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      try {
        const updated = await update({
          name: meta?.name ?? "",
          slug: meta?.slug,
          org: meta?.org ?? "",
          provider: provider.trim(),
          clientId: clientId.trim(),
          ...(clientSecret.trim() && { clientSecret: clientSecret.trim() }),
          authorizationUrl: authorizationUrl.trim(),
          tokenUrl: tokenUrl.trim(),
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
        setMode("view");
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateOAuthApp
      }
    },
    [
      meta, provider, clientId, clientSecret, authorizationUrl, tokenUrl,
      scopes, userinfoUrl, scopeParameterName, vendorApprovalStatus,
      vendorApprovalDocsUrl, update, clearUpdateError, onUpdated,
    ],
  );

  const handleDelete = useCallback(async () => {
    const id = meta?.id;
    if (!id) return;

    clearDeleteError();
    try {
      await deleteApp(id);
      onDeleted?.();
    } catch {
      // error state is managed by useDeleteOAuthApp
    }
  }, [meta, deleteApp, clearDeleteError, onDeleted]);

  const canSave =
    provider.trim() !== "" &&
    clientId.trim() !== "" &&
    authorizationUrl.trim() !== "" &&
    tokenUrl.trim() !== "" &&
    !isUpdating;

  const createdAt = oauthApp.status?.audit?.specAudit?.createdAt;
  const updatedAt = oauthApp.status?.audit?.specAudit?.updatedAt;

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
            {spec?.provider || meta?.name || "OAuth App"}
          </h3>
          {meta?.slug && (
            <span className="text-muted-foreground font-mono text-xs">
              {meta.slug}
            </span>
          )}
        </div>

        {mode === "view" && (
          <div className="flex items-center gap-1">
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
            <button
              type="button"
              onClick={() => {
                clearDeleteError();
                setConfirmingDelete(true);
              }}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
                "text-destructive-muted hover:text-destructive hover:bg-destructive-subtle",
                "transition-colors",
              )}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Inline delete confirmation */}
      {confirmingDelete && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive-subtle p-3"
          role="alert"
        >
          <p className="text-foreground mb-2 text-xs font-medium">
            Delete this OAuth app?
          </p>
          <p className="text-muted-foreground mb-3 text-[0.65rem]">
            This action is permanent. Any MCP server overrides referencing
            this app will lose their binding.
          </p>
          {deleteError && (
            <p className="text-destructive mb-2 text-[0.65rem]" role="alert">
              {getUserMessage(deleteError)}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
                "disabled:pointer-events-none disabled:opacity-40",
              )}
            >
              {isDeleting && <SpinnerIcon />}
              Delete permanently
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                clearDeleteError();
              }}
              disabled={isDeleting}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs",
                "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      {mode === "view" ? (
        <ViewMode
          spec={spec}
          createdAt={createdAt}
          updatedAt={updatedAt}
        />
      ) : (
        <form onSubmit={handleSave} className="space-y-3">
          <FieldInput
            id="stgm-oauth-edit-provider"
            label="Provider"
            value={provider}
            onChange={setProvider}
            placeholder="e.g. Slack"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id="stgm-oauth-edit-client-id"
            label="Client ID"
            value={clientId}
            onChange={setClientId}
            placeholder="OAuth client identifier"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id="stgm-oauth-edit-client-secret"
            label="Client secret"
            value={clientSecret}
            onChange={setClientSecret}
            placeholder="Leave empty to keep existing secret"
            type="password"
            hint="Only enter a value to replace the existing secret"
            disabled={isUpdating}
          />
          <FieldInput
            id="stgm-oauth-edit-auth-url"
            label="Authorization URL"
            value={authorizationUrl}
            onChange={setAuthorizationUrl}
            placeholder="https://vendor.com/oauth/authorize"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id="stgm-oauth-edit-token-url"
            label="Token URL"
            value={tokenUrl}
            onChange={setTokenUrl}
            placeholder="https://vendor.com/oauth/token"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id="stgm-oauth-edit-scopes"
            label="Scopes"
            value={scopes}
            onChange={setScopes}
            placeholder="read, write, admin"
            hint="Comma-separated OAuth scopes"
            disabled={isUpdating}
          />
          <FieldInput
            id="stgm-oauth-edit-userinfo-url"
            label="Userinfo URL"
            value={userinfoUrl}
            onChange={setUserinfoUrl}
            placeholder="https://vendor.com/userinfo"
            hint="OIDC endpoint for fetching user profile data (optional)"
            disabled={isUpdating}
          />
          <FieldInput
            id="stgm-oauth-edit-scope-param"
            label="Scope parameter name"
            value={scopeParameterName}
            onChange={setScopeParameterName}
            placeholder="scope"
            hint='Defaults to "scope". Some vendors use a non-standard name.'
            disabled={isUpdating}
          />

          <div className="space-y-1">
            <label
              htmlFor="stgm-oauth-edit-approval-status"
              className="text-xs font-medium text-foreground"
            >
              Vendor approval status
            </label>
            <select
              id="stgm-oauth-edit-approval-status"
              value={vendorApprovalStatus}
              onChange={(e) =>
                setVendorApprovalStatus(
                  e.target.value as typeof vendorApprovalStatus,
                )
              }
              disabled={isUpdating}
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
          </div>

          <FieldInput
            id="stgm-oauth-edit-approval-docs"
            label="Vendor approval docs URL"
            value={vendorApprovalDocsUrl}
            onChange={setVendorApprovalDocsUrl}
            placeholder="https://docs.example.com/byoa"
            hint="Help link shown when vendor approval is pending"
            disabled={isUpdating}
          />

          {updateError && (
            <p className="text-destructive text-[0.65rem]" role="alert">
              {getUserMessage(updateError)}
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
// Constants
// ---------------------------------------------------------------------------

const APPROVAL_STATUS_MAP = {
  pending: VendorApprovalStatus.PENDING,
  approved: VendorApprovalStatus.APPROVED,
  rejected: VendorApprovalStatus.REJECTED,
} as const;

const APPROVAL_STATUS_LABELS: Record<number, string> = {
  [VendorApprovalStatus.UNSPECIFIED]: "Unspecified",
  [VendorApprovalStatus.PENDING]: "Pending",
  [VendorApprovalStatus.APPROVED]: "Approved",
  [VendorApprovalStatus.REJECTED]: "Rejected",
};

function approvalStatusToKey(
  status?: VendorApprovalStatus,
): "unspecified" | "pending" | "approved" | "rejected" {
  switch (status) {
    case VendorApprovalStatus.PENDING:
      return "pending";
    case VendorApprovalStatus.APPROVED:
      return "approved";
    case VendorApprovalStatus.REJECTED:
      return "rejected";
    default:
      return "unspecified";
  }
}

// ---------------------------------------------------------------------------
// View mode
// ---------------------------------------------------------------------------

function ViewMode({
  spec,
  createdAt,
  updatedAt,
}: {
  spec: OAuthApp["spec"];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}) {
  return (
    <dl className="space-y-2.5">
      <Field label="Provider" value={spec?.provider} />
      <Field label="Client ID" value={spec?.clientId} mono />
      <Field label="Client secret" value="••••••••" />
      <Field label="Authorization URL" value={spec?.authorizationUrl} mono />
      <Field label="Token URL" value={spec?.tokenUrl} mono />
      {spec?.scopes && spec.scopes.length > 0 && (
        <Field label="Scopes" value={spec.scopes.join(", ")} mono />
      )}
      {spec?.userinfoUrl && (
        <Field label="Userinfo URL" value={spec.userinfoUrl} mono />
      )}
      {spec?.scopeParameterName && (
        <Field
          label="Scope parameter name"
          value={spec.scopeParameterName}
          mono
        />
      )}
      {spec?.vendorApprovalStatus !== undefined &&
        spec.vendorApprovalStatus !== VendorApprovalStatus.UNSPECIFIED && (
          <Field
            label="Vendor approval"
            value={
              APPROVAL_STATUS_LABELS[spec.vendorApprovalStatus] ??
              "Unknown"
            }
          />
        )}
      {spec?.vendorApprovalDocsUrl && (
        <Field label="Approval docs" value={spec.vendorApprovalDocsUrl} mono />
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

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

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

function FieldInput({
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
