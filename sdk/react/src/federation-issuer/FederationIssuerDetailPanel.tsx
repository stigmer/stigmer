"use client";

import { ArrowLeft } from "lucide-react";
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
import { useDeleteFederationIssuer } from "./useDeleteFederationIssuer.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { PermissionGate } from "../grant/PermissionGate.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { ResourceSlugField } from "../resource-detail/RenameSlugField.js";
import { Button } from "../button/Button.js";
import { Section } from "../resource-detail/Section.js";
import { Tag } from "../internal/surface/Tag.js";
import { FIELD_LABEL_CLASSES, FieldError, TextInput, ReadOnlyField, ReadOnlyFields } from "../internal/form/index.js";

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
  /**
   * Draw the issuer's name and handle as the panel's heading. `true` (the
   * default) where the panel stands alone; `false` where the page's own
   * title already names the issuer (the settings page while one is open).
   */
  readonly showName?: boolean;
  /**
   * Fired once the issuer is deleted from the panel's own "Delete this
   * issuer" card. The card shows only when this is given, for a caller the
   * server lets delete the issuer (`can_delete`).
   */
  readonly onDeleted?: () => void;
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
 * import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
 *
 * type Props = { issuer: FederationIssuer; onUpdated: () => void; onBack: () => void };
 *
 * function IssuerDetail({ issuer, onUpdated, onBack }: Props) {
 *   return <FederationIssuerDetailPanel federationIssuer={issuer} onUpdated={onUpdated} onBack={onBack} />;
 * }
 * ```
 */
export function FederationIssuerDetailPanel({
  federationIssuer,
  onUpdated,
  onBack,
  className,
  showName = true,
  onDeleted,
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
            <Button variant="ghost" size="xs" icon={<ArrowLeft className="stg:size-3" aria-hidden="true" />} onClick={onBack}>
              Back to list
            </Button>
          )}
          {showName && (
            <h3 className="stg:text-foreground stg:truncate stg:text-sm stg:font-semibold">
              {spec?.displayName || meta?.name || "Federation Issuer"}
            </h3>
          )}
          <div className="stg:flex stg:items-center stg:gap-2">
            {showName && meta?.slug && (
              <span className="stg:text-muted-foreground stg:font-mono stg:text-xs">
                {meta.slug}
              </span>
            )}
            <ProvisioningModeBadge spec={spec} />
          </div>
        </div>

        {mode === "view" && (
          <PermissionGate
            fail="closed"
            resource={{ kind: "federation_issuer", id: meta?.id ?? "" }}
            relation="can_edit"
          >
            <Button variant="outline" size="sm" onClick={enterEdit}>
              Edit
            </Button>
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
        <>
          <ViewMode
            spec={spec}
            createdAt={createdAt}
            updatedAt={updatedAt}
          />
          {onDeleted && meta?.id && (
            <DeleteIssuer issuerId={meta.id} name={spec?.displayName || meta.name || "this issuer"} onDeleted={onDeleted} />
          )}
        </>
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
            <FieldError>
              {saveErrorMessage(error, "federation issuer")}
            </FieldError>
          )}

          <div className="stg:flex stg:items-center stg:gap-2 stg:pt-1">
            <Button type="submit" disabled={!canSave} icon={isUpdating ? <SpinnerIcon size={12} /> : undefined}>
              Save changes
            </Button>
            <Button variant="ghost" onClick={cancelEdit} disabled={isUpdating}>
              Cancel
            </Button>
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
    <>
      <Section title="How tokens are checked">
        <ReadOnlyFields className="stg:p-4">
          <Field label="JWKS URI" value={spec?.jwksUri} mono />
          <Field label="Allowed issuers" value={spec?.allowedIssuers.join(", ")} mono />
          <Field label="Expected audience" value={spec?.expectedAudience} mono />
          {spec?.userinfoEndpoint && <Field label="Userinfo endpoint" value={spec.userinfoEndpoint} mono />}
          {spec?.externalIdClaim && <Field label="Customer id claim" value={spec.externalIdClaim} mono />}
        </ReadOnlyFields>
      </Section>
      <Section title="When someone signs in">
        <ReadOnlyFields className="stg:p-4">
          {spec && <Field label="Create accounts on sign-in" value={spec.createAccountsOnSignIn ? "On" : "Off"} />}
          {spec && <Field label="Sign-in role" value={formatSignInRole(spec.signInRole)} />}
          {createdAt && <Field label="Created" value={formatDate(timestampDate(createdAt))} />}
          {updatedAt && <Field label="Updated" value={formatDate(timestampDate(updatedAt))} />}
        </ReadOnlyFields>
      </Section>
    </>
  );
}

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
      <label htmlFor={id} className={FIELD_LABEL_CLASSES}>
        {label}
      </label>
      <TextInput
        id={id}
        type="text"
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

// ---------------------------------------------------------------------------
// Provisioning mode tag
// ---------------------------------------------------------------------------

function ProvisioningModeBadge({ spec }: { spec: FederationIssuer["spec"] }) {
  if (spec?.createAccountsOnSignIn) {
    return (
      <Tag>JIT</Tag>
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


/** The open issuer's own Delete, asked in the dialog that does it. */
function DeleteIssuer({
  issuerId,
  name,
  onDeleted,
}: {
  readonly issuerId: string;
  readonly name: string;
  readonly onDeleted: () => void;
}) {
  const { deleteProvider } = useDeleteFederationIssuer();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const consequence = `Tokens from ${name} stop working at once. People who joined through it keep their accounts and roles.`;
  const askToDelete = useCallback(async () => {
    const deleted = await confirm({
      title: `Delete ${name}?`,
      description: consequence,
      confirmLabel: "Delete issuer",
      variant: "destructive",
      action: async () => {
        await deleteProvider({ resourceId: issuerId });
      },
      failureTitle: `Couldn't delete ${name}.`,
    });
    if (deleted) onDeleted();
  }, [confirm, deleteProvider, issuerId, name, consequence, onDeleted]);

  return (
    <PermissionGate fail="closed" resource={{ kind: "federation_issuer", id: issuerId }} relation="can_delete">
      <Section title="Delete this issuer">
        <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-3 stg:p-4">
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">{consequence}</p>
          <Button variant="outline" size="sm" onClick={() => void askToDelete()}>
            Delete issuer
          </Button>
        </div>
        <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      </Section>
    </PermissionGate>
  );
}
