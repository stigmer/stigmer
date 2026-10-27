"use client";

/**
 * An organization's embedding settings: how people sign in to it from the
 * organization's own product, when the product's backend mints their
 * tokens with a service account's API key. Which web pages may use the
 * tokens, whether a first sign-in creates the person's account and with
 * which role, and which shared vaults their runs use.
 *
 * The settings are one message, saved whole through `updateEmbedding`, so
 * the panel is a form with a Save button. Editing needs `can_edit` on the
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
import { Switch } from "../switch/Switch.js";
import { VaultPicker } from "../vault/VaultPicker.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { UNSTYLED_FIELDSET, UNSTYLED_LIST } from "../internal/element-resets.js";
import { keptReference } from "../internal/kept-reference.js";

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

const INPUT_CLASS = cn(
  "stg:min-w-0 stg:flex-1 stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

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
  // Held here, not in the form: a save is read back as a new stored
  // version, which starts a fresh form, and it must still say Saved.
  const [saved, setSaved] = useState(false);
  // Fail-open: a server without sign-in answers every check allowed, and
  // the server refuses a save the answer missed.
  const { allowed: canEdit } = useCheckPermission(
    org ? { kind: "organization", id: org } : null,
    "can_edit",
  );

  if (isLoading && !organization) {
    return (
      <LoadingRegion className={cn("stg:space-y-4", className)} label="Loading embedding settings">
        <div className="stg:bg-muted-subtle stg:h-12 stg:animate-pulse stg:rounded" />
      </LoadingRegion>
    );
  }

  if (fetchError) {
    return (
      <div className={cn("stg:space-y-3", className)} role="alert">
        <p className="stg:text-destructive stg:text-sm">{getUserMessage(fetchError)}</p>
        <button
          type="button"
          onClick={refetch}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
          )}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!organization) return null;

  return (
    <EmbeddingForm
      // A fresh form for every stored version of the settings, so the form
      // starts from what the server holds after each read and save.
      key={JSON.stringify(organizationEmbeddingOf(organization))}
      org={org}
      stored={organizationEmbeddingOf(organization)}
      canEdit={canEdit}
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
  readonly canEdit: boolean;
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
  canEdit,
  serviceAccountsHref,
  saved,
  onSavedChange,
  refetch,
  onUpdated,
  className,
}: EmbeddingFormProps) {
  const baseId = useId();
  const createId = `${baseId}-create-accounts`;
  const roleId = `${baseId}-role`;
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
    <form className={cn("stg:flex stg:flex-col stg:gap-5", className)} onSubmit={(event) => void handleSubmit(event)}>
      <p className="stg:text-2xs stg:leading-snug stg:text-muted-foreground">
        Your product&apos;s backend signs its users in to this organization by minting a token for
        each, with the API key of a service account that is an admin here.
        {canEdit && serviceAccountsHref !== undefined && (
          <>
            {" "}
            <a href={serviceAccountsHref} className="stg:text-primary stg:underline-offset-2 stg:hover:underline">
              Manage service accounts
            </a>
            .
          </>
        )}
      </p>

      <fieldset className={cn(UNSTYLED_FIELDSET, "stg:space-y-2.5")} disabled={locked}>
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">Sign-in</legend>
        <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
          <div className="stg:min-w-0 stg:flex-1">
            <span id={`${createId}-title`} className="stg:block stg:text-xs stg:text-foreground">
              Create accounts on sign-in
            </span>
            <p id={`${createId}-description`} className="stg:text-2xs stg:leading-snug stg:text-muted-foreground">
              Create a person&apos;s Stigmer account the first time a token is minted for them. When
              off, the account must already exist.
            </p>
          </div>
          <Switch
            id={createId}
            checked={draft.createAccountsOnSignIn}
            onCheckedChange={toggleCreateAccounts}
            disabled={locked}
            aria-labelledby={`${createId}-title`}
            aria-describedby={`${createId}-description`}
          />
        </div>
        <div className="stg:space-y-1">
          <label htmlFor={roleId} className="stg:text-xs stg:text-foreground">
            Sign-in role
          </label>
          <select
            id={roleId}
            value={String(draft.signInRole)}
            onChange={(event) => edit({ signInRole: Number(event.target.value) as IamRole })}
            disabled={locked || !draft.createAccountsOnSignIn}
            aria-describedby={`${roleId}-hint`}
            className={cn(INPUT_CLASS, "stg:w-full")}
          >
            {SIGN_IN_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
          <p id={`${roleId}-hint`} className="stg:text-2xs stg:text-muted-foreground">
            Granted on this organization when a sign-in creates an account; None grants nothing.
            Accounts that already exist keep the roles they hold.
          </p>
        </div>
      </fieldset>

      <fieldset className={cn(UNSTYLED_FIELDSET, "stg:space-y-2")} disabled={locked}>
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">Allowed origins</legend>
        <p className="stg:text-2xs stg:text-muted-foreground">
          Web pages whose origin is listed here may use the tokens. Leave empty to allow every
          origin.
        </p>
        <div className="stg:flex stg:items-center stg:gap-2">
          <input
            type="text"
            value={originInput}
            onChange={(event) => setOriginInput(event.target.value)}
            onKeyDown={handleOriginKeyDown}
            placeholder="https://app.example.com"
            aria-label="Add an allowed origin"
            disabled={locked}
            className={INPUT_CLASS}
          />
          <button
            type="button"
            onClick={addOrigin}
            disabled={locked || originInput.trim() === ""}
            className={cn(
              "stg:shrink-0 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50 stg:transition-colors",
            )}
          >
            Add
          </button>
        </div>
        {draft.allowedOrigins.length > 0 && (
          <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-wrap stg:gap-1.5")} aria-label="Allowed origins">
            {draft.allowedOrigins.map((origin) => (
              <li
                key={origin}
                className="stg:inline-flex stg:items-center stg:gap-1 stg:rounded-full stg:border stg:border-border-muted stg:bg-muted-subtle stg:px-2 stg:py-0.5 stg:font-mono stg:text-2xs stg:text-foreground"
              >
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
      </fieldset>

      <fieldset className={cn(UNSTYLED_FIELDSET, "stg:space-y-2")} disabled={locked}>
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">Vaults</legend>
        <p className="stg:text-2xs stg:text-muted-foreground">
          Shared vaults whose keys the conversations of people signed in from your product use, in
          order.
        </p>
        <VaultPicker
          org={org}
          value={draft.vaults}
          onChange={(vaults: ResourceRef[]) => edit({ vaults })}
          disabled={locked}
        />
      </fieldset>

      {error && (
        <p className="stg:text-2xs stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      {canEdit ? (
        <div className="stg:flex stg:items-center stg:gap-2">
          <button
            type="submit"
            disabled={isUpdating}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-40",
            )}
          >
            {isUpdating && <SpinnerIcon size={12} />}
            Save
          </button>
          {saved && !isUpdating && (
            <span className="stg:text-2xs stg:text-muted-foreground" role="status">
              Saved
            </span>
          )}
        </div>
      ) : (
        <p className="stg:text-2xs stg:text-muted-foreground">
          Only organization admins can change these settings.
        </p>
      )}
    </form>
  );
}
