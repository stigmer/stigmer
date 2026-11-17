"use client";

import { ArrowLeft } from "lucide-react";
import { type FormEvent, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { buildOAuthAppProto, getUserMessage } from "@stigmer/client";
import { maskedEdit, saveErrorMessage } from "@stigmer/react-core/internal";
import type { OAuthApp } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import {
  TokenEndpointAuthMethod,
  VendorApprovalStatus,
} from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { useUpdateOAuthApp } from "./useUpdateOAuthApp.js";
import { useDeleteOAuthApp } from "./useDeleteOAuthApp.js";
import { PermissionGate } from "../grant/PermissionGate.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { parseAddressList } from "./addresses.js";
import { ResourceSlugField } from "../resource-detail/RenameSlugField.js";
import { Button } from "../button/Button.js";
import { Section } from "../resource-detail/Section.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { FIELD_LABEL_CLASSES, FieldError, Select, TextInput, ReadOnlyField, ReadOnlyFields } from "../internal/form/index.js";

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
  /**
   * Draw the app's name and handle as the panel's heading. `true` (the
   * default) where the panel stands alone; `false` where the page's own
   * title already names the app (the settings page while one is open).
   */
  readonly showName?: boolean;
}

/**
 * View and edit panel for an existing OAuth app.
 *
 * In **view mode**, displays all OAuth configuration fields in a
 * structured label/value layout, with an "Edit" button for a caller who
 * may edit the app (`can_edit`) and a "Delete" button for one who may
 * delete it (`can_delete`). Both belong to the organization's admins,
 * whoever created the app; someone granted viewer on an app sees it with no
 * actions.
 *
 * In **edit mode**, fields become editable inputs. The client secret
 * field shows a placeholder — leave it empty to keep the existing
 * secret, or enter a new value to replace it. "Save" submits the
 * update via {@link useUpdateOAuthApp}; "Cancel" discards changes
 * and returns to view mode.
 *
 * Delete asks in a confirm dialog that runs the delete, holds Cancel
 * while it works, and says a refusal inside the dialog.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * import type { OAuthApp } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
 *
 * type Props = { app: OAuthApp; onChanged: () => void; onBack: () => void };
 *
 * // onChanged refreshes the list; after a delete the panel goes back too.
 * function AppDetail({ app, onChanged, onBack }: Props) {
 *   return <OAuthAppDetailPanel oauthApp={app} onUpdated={onChanged} onDeleted={() => { onChanged(); onBack(); }} onBack={onBack} />;
 * }
 * ```
 */
export function OAuthAppDetailPanel({
  oauthApp,
  onUpdated,
  onDeleted,
  onBack,
  className,
  showName = true,
}: OAuthAppDetailPanelProps) {
  const baseId = useId();
  const spec = oauthApp.spec;
  const meta = oauthApp.metadata;

  const { update, isUpdating, error: updateError, clearError: clearUpdateError } =
    useUpdateOAuthApp();
  const { deleteApp } = useDeleteOAuthApp();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();

  const [mode, setMode] = useState<"view" | "edit">("view");

  // Edit form state — initialized from current resource
  const [provider, setProvider] = useState(spec?.provider ?? "");
  const [clientId, setClientId] = useState(spec?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState(
    spec?.authorizationUrl ?? "",
  );
  const [tokenUrl, setTokenUrl] = useState(spec?.tokenUrl ?? "");
  const [addresses, setAddresses] = useState(spec?.addresses.join(", ") ?? "");
  const [scopes, setScopes] = useState(spec?.scopes.join(", ") ?? "");
  const [userinfoUrl, setUserinfoUrl] = useState(spec?.userinfoUrl ?? "");
  const [scopeParameterName, setScopeParameterName] = useState(
    spec?.scopeParameterName ?? "",
  );
  const [tokenEndpointAuthMethod, setTokenEndpointAuthMethod] = useState(
    tokenAuthMethodToKey(spec?.tokenEndpointAuthMethod),
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
    setAddresses(spec?.addresses.join(", ") ?? "");
    setScopes(spec?.scopes.join(", ") ?? "");
    setUserinfoUrl(spec?.userinfoUrl ?? "");
    setScopeParameterName(spec?.scopeParameterName ?? "");
    setTokenEndpointAuthMethod(tokenAuthMethodToKey(spec?.tokenEndpointAuthMethod));
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
        // The update names every field this form owns, so a spec field the
        // form does not know about keeps its stored value. An empty secret
        // input leaves the secret unnamed, so the stored one stays; a
        // non-empty input replaces it.
        const secret = clientSecret.trim();
        const { resource, paths } = maskedEdit(oauthApp, buildOAuthAppProto, {
          provider: provider.trim(),
          clientId: clientId.trim(),
          ...(secret !== "" && { clientSecret: secret }),
          authorizationUrl: authorizationUrl.trim(),
          tokenUrl: tokenUrl.trim(),
          addresses: parseAddressList(addresses),
          scopes: parsedScopes.length > 0 ? parsedScopes : undefined,
          userinfoUrl: userinfoUrl.trim() || undefined,
          scopeParameterName: scopeParameterName.trim() || undefined,
          tokenEndpointAuthMethod:
            tokenEndpointAuthMethod !== "unspecified"
              ? TOKEN_AUTH_METHOD_MAP[tokenEndpointAuthMethod]
              : undefined,
          vendorApprovalStatus:
            vendorApprovalStatus !== "unspecified"
              ? APPROVAL_STATUS_MAP[vendorApprovalStatus]
              : undefined,
          vendorApprovalDocsUrl: vendorApprovalDocsUrl.trim() || undefined,
        });
        const updated = await update(resource, paths);
        setMode("view");
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateOAuthApp
      }
    },
    [
      oauthApp, provider, clientId, clientSecret, authorizationUrl, tokenUrl,
      addresses, scopes, userinfoUrl, scopeParameterName, tokenEndpointAuthMethod,
      vendorApprovalStatus, vendorApprovalDocsUrl, update, clearUpdateError,
      onUpdated,
    ],
  );

  const appName = spec?.provider || meta?.name || "this OAuth app";
  const askToDelete = useCallback(async () => {
    const id = meta?.id;
    if (!id) return;
    const deleted = await confirm({
      title: `Delete ${appName}?`,
      description: "Sign-ins that use it go back to Stigmer's own app, if there is one. MCP servers set to use it lose that setting.",
      confirmLabel: "Delete app",
      variant: "destructive",
      action: async () => {
        await deleteApp(id);
      },
      failureTitle: `Couldn't delete ${appName}.`,
    });
    if (deleted) onDeleted?.();
  }, [meta, appName, confirm, deleteApp, onDeleted]);

  const canSave =
    provider.trim() !== "" &&
    clientId.trim() !== "" &&
    authorizationUrl.trim() !== "" &&
    tokenUrl.trim() !== "" &&
    !isUpdating;

  const createdAt = oauthApp.status?.audit?.specAudit?.createdAt;
  const updatedAt = oauthApp.status?.audit?.specAudit?.updatedAt;

  return (
    <div className={cn("stg:space-y-4", className)}>
      {/* Header */}
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          {onBack && (
            <Button variant="ghost" size="xs" icon={<ArrowLeft className="stg:size-3" aria-hidden="true" />} onClick={onBack}>
              Back to list
            </Button>
          )}
          {showName && (
            <>
              <h3 className="stg:text-foreground stg:truncate stg:text-sm stg:font-semibold">
                {spec?.provider || meta?.name || "OAuth App"}
              </h3>
              {meta?.slug && (
                <span className="stg:text-muted-foreground stg:font-mono stg:text-xs">
                  {meta.slug}
                </span>
              )}
            </>
          )}
        </div>

        {mode === "view" && (
          <div className="stg:flex stg:items-center stg:gap-1">
            <PermissionGate
              fail="closed"
              resource={{ kind: "oauth_app", id: meta?.id ?? "" }}
              relation="can_edit"
            >
              <Button variant="outline" size="xs" onClick={enterEdit}>
                Edit
              </Button>
            </PermissionGate>
          </div>
        )}
      </div>

      {/* Rename: for whoever may delete the app */}
      {mode === "view" && (
        <ResourceSlugField
          kind="oauth_app"
          resourceId={meta?.id || null}
          currentSlug={meta?.slug ?? ""}
          onRenamed={(renamed) => onUpdated?.(renamed as OAuthApp)}
          className="stg:max-w-md"
        />
      )}

      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />

      {/* Body */}
      {mode === "view" ? (
        <>
          <ViewMode
            spec={spec}
            createdAt={createdAt}
            updatedAt={updatedAt}
          />
          <PermissionGate
            fail="closed"
            resource={{ kind: "oauth_app", id: meta?.id ?? "" }}
            relation="can_delete"
          >
            <Section title="Delete this app">
              <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-3 stg:p-4">
                <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
                  Sign-ins at its addresses go back to Stigmer&apos;s own app, if there is one.
                </p>
                <Button variant="outline" size="sm" onClick={() => void askToDelete()}>
                  Delete app
                </Button>
              </div>
            </Section>
          </PermissionGate>
        </>
      ) : (
        <form onSubmit={handleSave} className="stg:space-y-3">
          <FieldInput
            id={`${baseId}-provider`}
            label="Provider"
            value={provider}
            onChange={setProvider}
            placeholder="e.g. Slack"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id={`${baseId}-client-id`}
            label="Client ID"
            value={clientId}
            onChange={setClientId}
            placeholder="OAuth client identifier"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id={`${baseId}-client-secret`}
            label="Client secret"
            value={clientSecret}
            onChange={setClientSecret}
            placeholder="Leave empty to keep existing secret"
            type="password"
            hint="Only enter a value to replace the existing secret"
            disabled={isUpdating}
          />
          <FieldInput
            id={`${baseId}-auth-url`}
            label="Authorization URL"
            value={authorizationUrl}
            onChange={setAuthorizationUrl}
            placeholder="https://vendor.com/oauth/authorize"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id={`${baseId}-token-url`}
            label="Token URL"
            value={tokenUrl}
            onChange={setTokenUrl}
            placeholder="https://vendor.com/oauth/token"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id={`${baseId}-addresses`}
            label="Addresses"
            value={addresses}
            onChange={setAddresses}
            placeholder="https://mcp.slack.com/mcp, github.com"
            hint="Comma-separated: the tool URLs or Git hosts this app signs in to"
            disabled={isUpdating}
            required
          />
          <FieldInput
            id={`${baseId}-scopes`}
            label="Scopes"
            value={scopes}
            onChange={setScopes}
            placeholder="read, write, admin"
            hint="Comma-separated OAuth scopes"
            disabled={isUpdating}
          />
          <FieldInput
            id={`${baseId}-userinfo-url`}
            label="Userinfo URL"
            value={userinfoUrl}
            onChange={setUserinfoUrl}
            placeholder="https://vendor.com/userinfo"
            hint="OIDC endpoint for fetching user profile data (optional)"
            disabled={isUpdating}
          />
          <FieldInput
            id={`${baseId}-scope-param`}
            label="Scope parameter name"
            value={scopeParameterName}
            onChange={setScopeParameterName}
            placeholder="scope"
            hint='Defaults to "scope". Some vendors use a non-standard name.'
            disabled={isUpdating}
          />

          <div className="stg:space-y-1">
            <label
              htmlFor={`${baseId}-token-auth-method`}
              className={FIELD_LABEL_CLASSES}
            >
              Token endpoint auth method
            </label>
            <Select
              id={`${baseId}-token-auth-method`}
              value={tokenEndpointAuthMethod}
              onChange={(e) =>
                setTokenEndpointAuthMethod(
                  e.target.value as typeof tokenEndpointAuthMethod,
                )
              }
              disabled={isUpdating}
              className="stg:w-full"
            >
              <option value="unspecified">
                Unspecified (treated as HTTP Basic)
              </option>
              <option value="client_secret_basic">
                client_secret_basic (HTTP Basic header)
              </option>
              <option value="client_secret_post">
                client_secret_post (form body)
              </option>
            </Select>
          </div>

          <div className="stg:space-y-1">
            <label
              htmlFor={`${baseId}-approval-status`}
              className={FIELD_LABEL_CLASSES}
            >
              Vendor approval status
            </label>
            <Select
              id={`${baseId}-approval-status`}
              value={vendorApprovalStatus}
              onChange={(e) =>
                setVendorApprovalStatus(
                  e.target.value as typeof vendorApprovalStatus,
                )
              }
              disabled={isUpdating}
              className="stg:w-full"
            >
              <option value="unspecified">Unspecified (treated as approved)</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </Select>
          </div>

          <FieldInput
            id={`${baseId}-approval-docs`}
            label="Vendor approval docs URL"
            value={vendorApprovalDocsUrl}
            onChange={setVendorApprovalDocsUrl}
            placeholder="https://docs.example.com/oauth-app"
            hint="Help link shown when vendor approval is pending"
            disabled={isUpdating}
          />

          {updateError && (
            <FieldError>
              {saveErrorMessage(updateError, "OAuth app")}
            </FieldError>
          )}

          <div className="stg:flex stg:items-center stg:gap-2 stg:pt-1">
            <Button type="submit" size="xs" disabled={!canSave} icon={isUpdating ? <SpinnerIcon size={12} /> : undefined}>
              Save changes
            </Button>
            <Button variant="ghost" size="xs" onClick={cancelEdit} disabled={isUpdating}>
              Cancel
            </Button>
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

const TOKEN_AUTH_METHOD_MAP = {
  client_secret_basic: TokenEndpointAuthMethod.CLIENT_SECRET_BASIC,
  client_secret_post: TokenEndpointAuthMethod.CLIENT_SECRET_POST,
} as const;

const TOKEN_AUTH_METHOD_LABELS: Record<number, string> = {
  [TokenEndpointAuthMethod.CLIENT_SECRET_BASIC]: "client_secret_basic",
  [TokenEndpointAuthMethod.CLIENT_SECRET_POST]: "client_secret_post",
};

function tokenAuthMethodToKey(
  method?: TokenEndpointAuthMethod,
): "unspecified" | "client_secret_basic" | "client_secret_post" {
  switch (method) {
    case TokenEndpointAuthMethod.CLIENT_SECRET_BASIC:
      return "client_secret_basic";
    case TokenEndpointAuthMethod.CLIENT_SECRET_POST:
      return "client_secret_post";
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
    <>
      <Section title="The app">
        <ReadOnlyFields className="stg:p-4">
          <Field label="Provider" value={spec?.provider} />
          <Field label="Client ID" value={spec?.clientId} mono />
          <Field label="Client secret" value="••••••••" />
          <Field label="Addresses" value={spec?.addresses.join(", ")} mono />
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
          {spec?.tokenEndpointAuthMethod !== undefined &&
            spec.tokenEndpointAuthMethod !==
              TokenEndpointAuthMethod.UNSPECIFIED && (
              <Field
                label="Token endpoint auth method"
                value={
                  TOKEN_AUTH_METHOD_LABELS[spec.tokenEndpointAuthMethod] ??
                  "Unknown"
                }
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
          <>
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
          </>
        </ReadOnlyFields>
      </Section>
      {/* A provider's own addresses are the default; the card shows only an override. */}
      {(spec?.authorizationUrl || spec?.tokenUrl) && (
        <Section title="Its endpoints">
          <ReadOnlyFields className="stg:p-4">
            <Field label="Authorization URL" value={spec?.authorizationUrl} mono />
            <Field label="Token URL" value={spec?.tokenUrl} mono />
          </ReadOnlyFields>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** A read-only pair: the kit's `ReadOnlyField`. */
function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <ReadOnlyField label={label} mono={mono}>
      {value}
    </ReadOnlyField>
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
    <div className="stg:space-y-1">
      <label htmlFor={id} className={FIELD_LABEL_CLASSES}>
        {label}
      </label>
      <TextInput
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className="stg:w-full"
      />
      {hint && (
        <p className="stg:text-2xs stg:text-muted-foreground">{hint}</p>
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

