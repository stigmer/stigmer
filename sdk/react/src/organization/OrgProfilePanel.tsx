"use client";

import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, toOrganizationUpdateInput } from "@stigmer/sdk";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useOrganization } from "./useOrganization.js";
import { useUpdateOrganization } from "./useUpdateOrganization.js";
import { useRenameOrganization } from "./useRenameOrganization.js";
import { useOptionalOrg } from "./OrgProvider.js";
import { useSingleOrg } from "../server-info.js";
import { useIdentityProviderList } from "../identity-provider/useIdentityProviderList.js";
import { IDENTITY_PROVIDERS_MANAGED_BY_ADMINS } from "../identity-provider/copy.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DESCRIPTION_MAX_LEN = 500;
const LOGO_URL_MAX_LEN = 2048;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link OrgProfilePanel}. */
export interface OrgProfilePanelProps {
  /** The ID of the organization to display and edit. */
  readonly org: string;
  /**
   * Fired with the updated resource after a successful save or rename.
   * Inside an {@link OrgProvider} the panel has already refreshed the
   * provider's organizations, so a handler need not refresh them again.
   */
  readonly onUpdated?: (org: Organization) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained profile editor for an {@link Organization} resource.
 *
 * Fetches the organization by ID, displays editable fields (name,
 * description, logo URL) and read-only identifiers (slug, ID).
 * On save, calls `organization.update()` and fires `onUpdated`.
 *
 * The organization's owners (`can_delete` on it) can also rename it: the
 * slug becomes an editable field whose Rename action calls
 * `organization.rename()` and fires `onUpdated` with the renamed resource.
 * The Rename action stays disabled until the panel shows the renamed slug,
 * so one rename is in flight at a time.
 *
 * Inside an {@link OrgProvider}, the panel is the one that refreshes the
 * provider's organizations after a save or a rename, once each, so every
 * name and slug it shows follows, and the active organization stays
 * selected.
 * The field is never shown on a server that holds one organization, where
 * the organization is not named anywhere.
 *
 * All visual properties flow through `--stgm-*` design tokens. The
 * component has zero dependencies on Console routing, auth context,
 * or layout — platform builders can embed it directly:
 *
 * @example
 * ```tsx
 * <OrgProfilePanel
 *   org="org-id-123"
 *   onUpdated={(org) => console.log("Saved:", org.metadata?.name)}
 * />
 * ```
 */
export function OrgProfilePanel({
  org,
  onUpdated,
  className,
}: OrgProfilePanelProps) {
  const baseId = useId();
  const {
    organization,
    isLoading: isFetching,
    error: fetchError,
    refetch,
  } = useOrganization(org || null);
  const orgContext = useOptionalOrg();

  const {
    update,
    isUpdating,
    error: updateError,
    clearError,
  } = useUpdateOrganization();

  // Form state — synchronized from server data when it loads/changes.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  // Track the server snapshot so we can detect changes and reset.
  const serverName = organization?.metadata?.name ?? "";
  const serverDescription = organization?.spec?.description ?? "";
  const serverLogoUrl = organization?.spec?.logoUrl ?? "";
  const serverSlug = organization?.metadata?.slug ?? "";
  const serverOrgId = organization?.metadata?.id ?? "";
  const isPersonal = organization?.spec?.isPersonal ?? false;

  // Renaming is the owners' act; the check fails closed so the field never
  // flashes for someone the server would refuse. A single-organization
  // server never names its organization, so it offers no rename.
  const singleOrg = useSingleOrg();
  const renameCheck = useCheckPermission(
    serverOrgId ? { kind: "organization", id: serverOrgId } : null,
    "can_delete",
    { fail: "closed" },
  );
  const canRename = singleOrg === false && renameCheck.allowed;

  // Sync form fields when server data changes.
  useEffect(() => {
    if (!organization) return;
    setName(organization.metadata?.name ?? "");
    setDescription(organization.spec?.description ?? "");
    setLogoUrl(organization.spec?.logoUrl ?? "");
  }, [organization]);

  const hasChanges = useMemo(
    () =>
      name.trim() !== serverName ||
      description.trim() !== serverDescription ||
      logoUrl.trim() !== serverLogoUrl,
    [name, description, logoUrl, serverName, serverDescription, serverLogoUrl],
  );

  const canSubmit = name.trim().length > 0 && !isUpdating && hasChanges;

  // The provider's one refresh after a save or a rename. It re-selects the
  // active organization by its id, which a rename leaves alone, so renaming
  // another organization switches nothing.
  const refreshProvider = useCallback(() => {
    orgContext?.refresh(orgContext.activeOrg?.metadata?.id);
  }, [orgContext]);

  const handleDiscard = useCallback(() => {
    setName(serverName);
    setDescription(serverDescription);
    setLogoUrl(serverLogoUrl);
    clearError();
  }, [serverName, serverDescription, serverLogoUrl, clearError]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit || !organization) return;

      clearError();
      try {
        // update() is a full-spec replace: spread the complete mapped input
        // so unedited spec fields (e.g. preferences) survive the save, and
        // override only the fields this form edits.
        const updated = await update({
          ...toOrganizationUpdateInput(organization),
          name: name.trim(),
          description: description.trim() || undefined,
          logoUrl: logoUrl.trim() || undefined,
        });
        refetch();
        refreshProvider();
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateOrganization
      }
    },
    [
      canSubmit,
      organization,
      name,
      description,
      logoUrl,
      update,
      clearError,
      refetch,
      refreshProvider,
      onUpdated,
    ],
  );

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (isFetching && !organization) {
    return (
      <LoadingRegion
        className={cn("stg:space-y-4", className)}
        label="Loading organization profile"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="stg:bg-muted-subtle stg:h-10 stg:animate-pulse stg:rounded"
            style={{ width: `${90 - i * 12}%` }}
          />
        ))}
      </LoadingRegion>
    );
  }

  // -----------------------------------------------------------------------
  // Fetch error
  // -----------------------------------------------------------------------

  if (fetchError) {
    return (
      <div className={cn("stg:space-y-3", className)} role="alert">
        <p className="stg:text-destructive stg:text-sm">
          {getUserMessage(fetchError)}
        </p>
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

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("stg:space-y-6", className)}
    >
      {/* -- Identifiers: the slug is renamable by owners, the ID never changes -- */}
      <div className="stg:space-y-3">
        {canRename ? (
          <RenameSlugField
            orgId={serverOrgId}
            currentSlug={serverSlug}
            onRenamed={(renamed) => {
              refetch();
              refreshProvider();
              onUpdated?.(renamed);
            }}
          />
        ) : (
          <ReadOnlyField label="Slug" value={serverSlug} mono />
        )}
        <ReadOnlyField label="Organization ID" value={serverOrgId} />
        {isPersonal && (
          <div>
            <span className="stg:bg-primary-subtle stg:text-primary stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wider">
              Personal
            </span>
          </div>
        )}
      </div>

      <hr className="stg:border-border" />

      {/* -- Editable fields -- */}
      <div className="stg:space-y-4">
        {/* Name */}
        <div className="stg:space-y-1">
          <label
            htmlFor={`${baseId}-name`}
            className="stg:text-xs stg:font-medium stg:text-foreground"
          >
            Name
          </label>
          <input
            id={`${baseId}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isUpdating}
            required
            className={cn(
              "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          />
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            The display name shown in the sidebar and across the platform.
          </p>
        </div>

        {/* Description */}
        <div className="stg:space-y-1">
          <label
            htmlFor={`${baseId}-desc`}
            className="stg:text-xs stg:font-medium stg:text-foreground"
          >
            Description
          </label>
          <textarea
            id={`${baseId}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX_LEN}
            rows={3}
            disabled={isUpdating}
            placeholder="What is this organization for?"
            className={cn(
              "stg:w-full stg:resize-y stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          />
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            {description.length}/{DESCRIPTION_MAX_LEN} characters
          </p>
        </div>

        {/* Logo URL */}
        <div className="stg:space-y-1">
          <label
            htmlFor={`${baseId}-logo`}
            className="stg:text-xs stg:font-medium stg:text-foreground"
          >
            Logo URL
          </label>
          <input
            id={`${baseId}-logo`}
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            maxLength={LOGO_URL_MAX_LEN}
            disabled={isUpdating}
            placeholder="https://example.com/logo.png"
            className={cn(
              "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          />
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            A public URL to your organization&apos;s logo image.
          </p>
          <LogoPreview url={logoUrl.trim()} />
        </div>
      </div>

      {/* -- Error feedback -- */}
      {updateError && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(updateError)}
        </p>
      )}

      {/* -- Actions -- */}
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
          {isUpdating && <SpinnerIcon size={12} />}
          Save changes
        </button>

        {hasChanges && !isUpdating && (
          <button
            type="button"
            onClick={handleDiscard}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            )}
          >
            Discard
          </button>
        )}
      </div>

      {/* -- Identity Providers summary -- */}
      <IdentityProvidersSummary orgId={serverOrgId} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// IdentityProvidersSummary — shows linked IDPs on the org profile
// ---------------------------------------------------------------------------

/**
 * The list holds only the providers the caller may view, so an empty list
 * invites setting one up only when the server has not said the caller may
 * not create providers; otherwise it says who manages them.
 */
function IdentityProvidersSummary({ orgId }: { orgId: string }) {
  const idpAvailable = useResourceAvailable(ApiResourceKind.identity_provider);
  const { identityProviders, isLoading } = useIdentityProviderList(
    idpAvailable && orgId ? orgId : null,
  );
  const createCheck = useCheckPermission(
    idpAvailable && orgId ? { kind: "organization", id: orgId } : null,
    "can_create_idp",
  );
  const deniedCreate = !createCheck.isLoading && !createCheck.allowed;

  if (!idpAvailable || !orgId) return null;

  return (
    <>
      <hr className="stg:border-border" />
      <div className="stg:space-y-2">
        <p className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground stg:uppercase stg:tracking-wider">
          Identity Providers
        </p>

        {isLoading ? (
          <div className="stg:bg-muted-subtle stg:h-8 stg:animate-pulse stg:rounded" />
        ) : identityProviders.length === 0 && deniedCreate ? (
          <p className="stg:text-xs stg:text-muted-foreground">
            {IDENTITY_PROVIDERS_MANAGED_BY_ADMINS}
          </p>
        ) : identityProviders.length === 0 ? (
          <p className="stg:text-xs stg:text-muted-foreground">
            No identity providers configured.{" "}
            <a
              href="/settings/identity-providers"
              className="stg:text-primary stg:hover:text-primary-hover stg:underline stg:underline-offset-2"
            >
              Set up federated authentication
            </a>
          </p>
        ) : (
          <div className="stg:space-y-1.5">
            {identityProviders.map((idp) => {
              const spec = idp.spec;
              const displayName =
                spec?.displayName || idp.metadata?.name || "Unnamed";
              const isSso = spec?.isSsoProvider;
              const isJit = !isSso && spec?.autoProvisionAccounts;

              return (
                <div
                  key={idp.metadata?.id}
                  className="stg:flex stg:items-center stg:gap-2 stg:text-xs"
                >
                  <ShieldSmallIcon />
                  <span className="stg:text-foreground stg:truncate">{displayName}</span>
                  {isSso && (
                    <span className="stg:rounded-full stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-1.5 stg:py-px stg:text-[0.6rem] stg:font-medium stg:text-primary">
                      SSO
                    </span>
                  )}
                  {isJit && (
                    <span className="stg:rounded-full stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-1.5 stg:py-px stg:text-[0.6rem] stg:font-medium stg:text-primary">
                      JIT
                    </span>
                  )}
                </div>
              );
            })}
            <a
              href="/settings/identity-providers"
              className="stg:inline-block stg:text-[0.65rem] stg:text-primary stg:hover:text-primary-hover stg:underline stg:underline-offset-2"
            >
              Manage
            </a>
          </div>
        )}
      </div>
    </>
  );
}

function ShieldSmallIcon() {
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
      className="stg:shrink-0 stg:text-muted-foreground"
    >
      <path d="M8 1.5L2 4v4c0 3.5 2.5 5.5 6 7 3.5-1.5 6-3.5 6-7V4L8 1.5z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// RenameSlugField — the owners' slug editor
// ---------------------------------------------------------------------------

/**
 * The slug as an editable field with its own Rename action, apart from the
 * profile's Save: a rename changes the name in every link to the
 * organization, so it is a deliberate act of its own. It sits inside the
 * profile form, so Enter in the field renames rather than submitting the
 * profile. After a rename lands, `currentSlug` is the old slug until the
 * panel's refetch returns, so the field stays settling (disabled) until
 * `currentSlug` moves: a second click cannot send the same rename again.
 */
function RenameSlugField({
  orgId,
  currentSlug,
  onRenamed,
}: {
  orgId: string;
  currentSlug: string;
  onRenamed: (org: Organization) => void;
}) {
  const inputId = useId();
  const { rename, isRenaming, error, clearError } = useRenameOrganization();
  const [slug, setSlug] = useState(currentSlug);
  // The slug a landed rename left behind, until the panel shows another.
  const [renamedFrom, setRenamedFrom] = useState<string | null>(null);

  useEffect(() => {
    setSlug(currentSlug);
    setRenamedFrom(null);
  }, [currentSlug]);

  const settling = renamedFrom !== null;
  const busy = isRenaming || settling;
  const next = slug.trim();
  const canRename = next.length > 0 && next !== currentSlug && !busy;

  const submit = useCallback(async () => {
    if (!canRename) return;
    clearError();
    try {
      const renamed = await rename(orgId, next);
      setRenamedFrom(currentSlug);
      onRenamed(renamed);
    } catch {
      // error state is managed by useRenameOrganization
    }
  }, [canRename, clearError, rename, orgId, next, currentSlug, onRenamed]);

  return (
    <div className="stg:space-y-1">
      <label
        htmlFor={inputId}
        className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground stg:uppercase stg:tracking-wider"
      >
        Slug
      </label>
      <div className="stg:flex stg:items-center stg:gap-2">
        <input
          id={inputId}
          type="text"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            clearError();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:font-mono stg:text-xs stg:text-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canRename}
          className={cn(
            "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:border stg:border-input stg:text-foreground stg:hover:bg-accent-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {busy && <SpinnerIcon size={12} />}
          Rename
        </button>
      </div>
      {error ? (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      ) : (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          The name in links to this organization. Links with the old slug keep
          working for 30 days after a rename.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadOnlyField — copiable label/value pair
// ---------------------------------------------------------------------------

function ReadOnlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const { copy, copied } = useCopyFeedback();

  if (!value) return null;

  return (
    <div className="stg:space-y-0.5">
      <p className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground stg:uppercase stg:tracking-wider">
        {label}
      </p>
      <div className="stg:flex stg:items-center stg:gap-2">
        <span
          className={cn(
            "stg:text-xs stg:text-foreground stg:select-all",
            mono && "stg:font-mono",
          )}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={() => void copy(value)}
          className={cn(
            "stg:rounded stg:px-1.5 stg:py-0.5 stg:text-[0.6rem]",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:transition-colors",
          )}
          aria-label={`Copy ${label}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LogoPreview — shows a small preview when the URL looks like an image
// ---------------------------------------------------------------------------

function LogoPreview({ url }: { url: string }) {
  const [status, setStatus] = useState<"idle" | "loaded" | "error">("idle");

  useEffect(() => {
    setStatus("idle");
  }, [url]);

  if (!url || status === "error") return null;

  return (
    <div className="stg:mt-2">
      <img
        src={url}
        alt="Organization logo preview"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={cn(
          "stg:h-10 stg:w-10 stg:rounded-md stg:border stg:border-border stg:object-contain stg:bg-background",
          status === "idle" && "stg:opacity-0",
          status === "loaded" && "stg:opacity-100",
        )}
      />
    </div>
  );
}

