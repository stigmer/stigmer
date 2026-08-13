"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useOrganization } from "./useOrganization.js";
import { useUpdateOrganization } from "./useUpdateOrganization.js";
import { useIdentityProviderList } from "../identity-provider/useIdentityProviderList.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

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
  readonly orgId: string;
  /** Fired with the updated resource after a successful save. */
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
 * All visual properties flow through `--stgm-*` design tokens. The
 * component has zero dependencies on Console routing, auth context,
 * or layout — platform builders can embed it directly:
 *
 * @example
 * ```tsx
 * <OrgProfilePanel
 *   orgId="org-id-123"
 *   onUpdated={(org) => console.log("Saved:", org.metadata?.name)}
 * />
 * ```
 */
export function OrgProfilePanel({
  orgId,
  onUpdated,
  className,
}: OrgProfilePanelProps) {
  const {
    organization,
    isLoading: isFetching,
    error: fetchError,
    refetch,
  } = useOrganization(orgId || null);

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
        const updated = await update({
          name: name.trim(),
          slug: serverSlug,
          org: serverSlug,
          description: description.trim() || undefined,
          logoUrl: logoUrl.trim() || undefined,
        });
        refetch();
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
      serverSlug,
      update,
      clearError,
      refetch,
      onUpdated,
    ],
  );

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (isFetching && !organization) {
    return (
      <div
        className={cn("stg:space-y-4", className)}
        aria-busy="true"
        aria-label="Loading organization profile"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="stg:bg-muted-subtle stg:h-10 stg:animate-pulse stg:rounded"
            style={{ width: `${90 - i * 12}%` }}
          />
        ))}
      </div>
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
      {/* -- Read-only identifiers -- */}
      <div className="stg:space-y-3">
        <ReadOnlyField label="Slug" value={serverSlug} mono />
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
            htmlFor="stgm-org-profile-name"
            className="stg:text-xs stg:font-medium stg:text-foreground"
          >
            Name
          </label>
          <input
            id="stgm-org-profile-name"
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
            htmlFor="stgm-org-profile-desc"
            className="stg:text-xs stg:font-medium stg:text-foreground"
          >
            Description
          </label>
          <textarea
            id="stgm-org-profile-desc"
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
            htmlFor="stgm-org-profile-logo"
            className="stg:text-xs stg:font-medium stg:text-foreground"
          >
            Logo URL
          </label>
          <input
            id="stgm-org-profile-logo"
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
      <IdentityProvidersSummary orgSlug={serverSlug} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// IdentityProvidersSummary — shows linked IDPs on the org profile
// ---------------------------------------------------------------------------

function IdentityProvidersSummary({ orgSlug }: { orgSlug: string }) {
  const idpAvailable = useResourceAvailable(ApiResourceKind.identity_provider);
  const { identityProviders, isLoading } = useIdentityProviderList(
    idpAvailable && orgSlug ? orgSlug : null,
  );

  if (!idpAvailable || !orgSlug) return null;

  return (
    <>
      <hr className="stg:border-border" />
      <div className="stg:space-y-2">
        <p className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground stg:uppercase stg:tracking-wider">
          Identity Providers
        </p>

        {isLoading ? (
          <div className="stg:bg-muted-subtle stg:h-8 stg:animate-pulse stg:rounded" />
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
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

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
          onClick={handleCopy}
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

