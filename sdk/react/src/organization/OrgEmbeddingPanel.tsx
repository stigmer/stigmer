"use client";

/**
 * An organization's embedding settings: how people sign in to it from the
 * organization's own product, when the product's backend mints their
 * tokens with a service account's API key. Which web pages may use the
 * tokens, whether a first sign-in creates the person's account and with
 * which role, and which shared vaults their runs use.
 *
 * The page draws three cards: sign-in from the product (account creation
 * and its role), the web pages allowed to use the tokens, and the vaults
 * their conversations use. The settings are one message, saved whole
 * through `updateEmbedding`, so the cards sit in one form with one Save
 * changes button under them. Editing needs `can_edit` on the
 * organization (its admins); everyone who reads the organization reads the
 * settings, none of which is secret.
 */
import { type FormEvent, type KeyboardEvent, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage, type ResourceRef } from "@stigmer/client";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { useOrganization } from "./useOrganization.js";
import {
  organizationEmbeddingOf,
  useUpdateOrganizationEmbedding,
  type OrganizationEmbeddingValue,
} from "./useUpdateOrganizationEmbedding.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { EditCheckFailed } from "./EditCheckFailed.js";
import { VaultPicker } from "../vault/VaultPicker.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Button } from "../button/Button.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { keptReference } from "../internal/kept-reference.js";
import { tagClasses } from "../internal/surface/Tag.js";
import { Field, FieldError, FieldHint, FieldLegend, Select, SwitchField, TextInput } from "../internal/form/index.js";
import { Section } from "../resource-detail/Section.js";
import { useOrgDisplayName } from "./useOrgDisplayName.js";

/** The roles a first sign-in may grant; owner is never offered, since ownership is assigned explicitly. */
const SIGN_IN_ROLE_OPTIONS: readonly { readonly value: IamRole; readonly label: string }[] = [
  { value: IamRole.iam_role_unspecified, label: "None" },
  { value: IamRole.viewer, label: "Viewer" },
  { value: IamRole.member, label: "Member" },
  { value: IamRole.admin, label: "Admin" },
];

/** The display name of a sign-in role; unspecified reads as "None". */
export function formatSignInRole(role: IamRole): string {
  return SIGN_IN_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "None";
}

/** Props for {@link OrgEmbeddingPanel}. */
export interface OrgEmbeddingPanelProps {
  /** The ID of the organization whose embedding settings to display and edit. */
  readonly org: string;
  /** Where the organization's service accounts are managed; the link is omitted when absent. */
  readonly serviceAccountsHref?: string;
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (org: Organization) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained editor for an organization's embedding settings
 * (`spec.embedding`), saved through `organization.updateEmbedding()`.
 *
 * All visual properties flow through `--stgm-*` design tokens; no routing
 * or auth dependencies, so a platform builder can embed it directly:
 *
 * @example
 * ```tsx
 * <OrgEmbeddingPanel org="org-id-123" serviceAccountsHref="/settings/service-accounts" />
 * ```
 */
export function OrgEmbeddingPanel({ org, serviceAccountsHref, onUpdated, className }: OrgEmbeddingPanelProps) {
  const { organization, isLoading, error: fetchError, refetch } = useOrganization(org || null);
  // The sentences name the organization by its slug where the server holds several.
  const orgName = useOrgDisplayName(organization?.metadata?.slug);
  // Held here, not in the form: a save is read back as a new stored
  // version, which starts a fresh form, and it must still say Saved.
  const [saved, setSaved] = useState(false);
  // Editing is the admins' (`can_edit`), offered only on the server's yes:
  // never while the check is in flight and never on a failed check (the
  // check fails closed), so a member never sees an editable form. A settled
  // no says who can; a failed check says it could not check, and the
  // content stays read-only (stigmer#2662).
  const editCheck = useCheckPermission(org ? { kind: "organization", id: org } : null, "can_edit", { fail: "closed" });
  const canEdit = !editCheck.isLoading && editCheck.allowed;
  const checkFailed = !editCheck.isLoading && editCheck.error !== null;
  const editDenied = !editCheck.isLoading && !checkFailed && !editCheck.allowed;

  if (isLoading && !organization) {
    return <SettingsSkeleton label="Loading embedding settings" rows={2} className={className} />;
  }

  if (fetchError) {
    return <ErrorMessage error={fetchError} title="Couldn't load the embedding settings." retry={refetch} className={className} />;
  }

  if (!organization) return null;

  return (
    <EmbeddingForm
      // A fresh form for every stored version of the settings, so the form
      // starts from what the server holds after each read and save.
      key={JSON.stringify(organizationEmbeddingOf(organization))}
      org={org}
      stored={organizationEmbeddingOf(organization)}
      orgName={orgName}
      canEdit={canEdit}
      editDenied={editDenied}
      checkFailed={checkFailed}
      onRetryCheck={editCheck.refetch}
      serviceAccountsHref={serviceAccountsHref}
      saved={saved}
      onSavedChange={setSaved}
      refetch={refetch}
      onUpdated={onUpdated}
      className={className}
    />
  );
}

interface EmbeddingFormProps {
  readonly org: string;
  readonly stored: OrganizationEmbeddingValue;
  /** How the sentences name the organization: its slug, or "this organization". */
  readonly orgName: string;
  readonly canEdit: boolean;
  /** The server said no: the form says who can change it. */
  readonly editDenied: boolean;
  /** The permission check failed: the form stays read-only and says so. */
  readonly checkFailed: boolean;
  /** Asks the edit check again after it failed. */
  readonly onRetryCheck: () => void;
  readonly serviceAccountsHref: string | undefined;
  /** Whether the last save succeeded and nothing was edited since. */
  readonly saved: boolean;
  readonly onSavedChange: (saved: boolean) => void;
  readonly refetch: () => void;
  readonly onUpdated: ((org: Organization) => void) | undefined;
  readonly className: string | undefined;
}

/** The settings form, started from the stored settings. */
function EmbeddingForm({
  org,
  stored,
  orgName,
  canEdit,
  editDenied,
  checkFailed,
  onRetryCheck,
  serviceAccountsHref,
  saved,
  onSavedChange,
  refetch,
  onUpdated,
  className,
}: EmbeddingFormProps) {
  const baseId = useId();
  const roleId = `${baseId}-role`;
  const originsId = `${baseId}-origins`;
  const vaultsId = `${baseId}-vaults`;
  const { updateEmbedding, isUpdating, error, clearError } = useUpdateOrganizationEmbedding();
  const [draft, setDraft] = useState<OrganizationEmbeddingValue>(stored);
  const [originInput, setOriginInput] = useState("");

  const edit = useCallback(
    (next: Partial<OrganizationEmbeddingValue>) => {
      setDraft((current) => ({ ...current, ...next }));
      onSavedChange(false);
      clearError();
    },
    [clearError, onSavedChange],
  );

  const addOrigin = useCallback(() => {
    const origin = originInput.trim();
    if (origin !== "" && !draft.allowedOrigins.includes(origin)) {
      edit({ allowedOrigins: [...draft.allowedOrigins, origin] });
    }
    setOriginInput("");
  }, [originInput, draft.allowedOrigins, edit]);

  const handleOriginKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addOrigin();
      }
    },
    [addOrigin],
  );

  const toggleCreateAccounts = useCallback(
    (next: boolean) => {
      // A role is granted only to an account the sign-in creates.
      edit({ createAccountsOnSignIn: next, ...(next ? {} : { signInRole: IamRole.iam_role_unspecified }) });
    },
    [edit],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      onSavedChange(false);
      try {
        const updated = await updateEmbedding(org, {
          ...draft,
          vaults: draft.vaults.map(keptReference),
        });
        onSavedChange(true);
        refetch();
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateOrganizationEmbedding
      }
    },
    [org, draft, updateEmbedding, onSavedChange, refetch, onUpdated],
  );

  const locked = isUpdating || !canEdit;

  return (
    <form className={cn("stg:flex stg:flex-col stg:gap-6", className)} onSubmit={(event) => void handleSubmit(event)}>
      <Section title="Sign-in from your product">
        <div className="stg:flex stg:flex-col stg:gap-4 stg:p-4">
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            Your product&apos;s backend signs its users in to {orgName} by minting a token for each
            one with a service account&apos;s key.
            {canEdit && serviceAccountsHref !== undefined && (
              <>
                {" "}
                <a href={serviceAccountsHref} className="stg:text-primary stg:underline stg:underline-offset-2 stg:hover:text-primary-hover">
                  Manage service accounts
                </a>
              </>
            )}
          </p>
          <SwitchField
            label="Create accounts on sign-in"
            hint="Make a person's Stigmer account the first time a token is minted for them."
            checked={draft.createAccountsOnSignIn}
            onCheckedChange={toggleCreateAccounts}
            disabled={locked}
          />
          <Field
            id={roleId}
            label="Sign-in role"
            hint={`Granted on ${orgName} when a sign-in creates an account; None grants nothing. Accounts that already exist keep their roles.`}
          >
            <Select
              value={String(draft.signInRole)}
              onChange={(event) => edit({ signInRole: Number(event.target.value) as IamRole })}
              disabled={locked || !draft.createAccountsOnSignIn}
            >
              {SIGN_IN_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Allowed web pages">
        <div className="stg:flex stg:flex-col stg:gap-2 stg:p-4" role="group" aria-labelledby={`${originsId}-label`}>
          <FieldLegend id={`${originsId}-label`}>Allowed origins</FieldLegend>
          {draft.allowedOrigins.length > 0 && (
            <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-wrap stg:gap-1.5")} aria-label="Allowed origins">
              {draft.allowedOrigins.map((origin) => (
                <li key={origin} className={tagClasses({ mono: true })}>
                  {origin}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => edit({ allowedOrigins: draft.allowedOrigins.filter((o) => o !== origin) })}
                      disabled={isUpdating}
                      aria-label={`Remove ${origin}`}
                      className="stg:text-muted-foreground stg:hover:text-destructive stg:transition-colors"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="stg:flex stg:items-center stg:gap-2">
            <TextInput
              className="stg:flex-1"
              type="text"
              value={originInput}
              onChange={(event) => setOriginInput(event.target.value)}
              onKeyDown={handleOriginKeyDown}
              placeholder="https://"
              aria-label="Add an allowed origin"
              aria-describedby={`${originsId}-hint`}
              disabled={locked}
            />
            <Button variant="outline" onClick={addOrigin} disabled={locked || originInput.trim() === ""}>
              Add
            </Button>
          </div>
          <FieldHint id={`${originsId}-hint`}>
            Web pages at these origins may use the tokens. Leave empty to allow every origin.
          </FieldHint>
        </div>
      </Section>

      <Section title="Vaults for these conversations">
        <div className="stg:flex stg:flex-col stg:gap-2 stg:p-4" role="group" aria-labelledby={`${vaultsId}-label`} aria-describedby={`${vaultsId}-hint`}>
          <FieldLegend id={`${vaultsId}-label`}>Shared vaults</FieldLegend>
          <VaultPicker
            org={org}
            value={draft.vaults}
            onChange={(vaults: ResourceRef[]) => edit({ vaults })}
            disabled={locked}
          />
          <FieldHint id={`${vaultsId}-hint`}>
            The keys conversations of people signed in from your product use, in this order.
          </FieldHint>
        </div>
      </Section>

      {error && <FieldError>{getUserMessage(error)}</FieldError>}

      {canEdit ? (
        <div className="stg:flex stg:items-center stg:gap-2">
          <Button type="submit" disabled={isUpdating} icon={isUpdating ? <SpinnerIcon size={14} /> : undefined}>
            Save changes
          </Button>
          {saved && !isUpdating && (
            <span className="stg:text-xs stg:text-muted-foreground" role="status">
              Saved
            </span>
          )}
        </div>
      ) : editDenied ? (
        <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
          Only organization admins can change these settings.
        </p>
      ) : checkFailed ? (
        <EditCheckFailed what="change these settings" onRetry={onRetryCheck} />
      ) : null}
    </form>
  );
}
