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
        className={cn("space-y-4", className)}
        aria-busy="true"
        aria-label="Loading organization profile"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="bg-muted-subtle h-10 animate-pulse rounded"
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
      <div className={cn("space-y-3", className)} role="alert">
        <p className="text-destructive text-sm">
          {getUserMessage(fetchError)}
        </p>
        <button
          type="button"
          onClick={refetch}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
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
      className={cn("space-y-6", className)}
    >
      {/* -- Read-only identifiers -- */}
      <div className="space-y-3">
        <ReadOnlyField label="Slug" value={serverSlug} mono />
        <ReadOnlyField label="Organization ID" value={serverOrgId} />
        {isPersonal && (
          <div>
            <span className="bg-primary-subtle text-primary rounded-full px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wider">
              Personal
            </span>
          </div>
        )}
      </div>

      <hr className="border-border" />

      {/* -- Editable fields -- */}
      <div className="space-y-4">
        {/* Name */}
        <div className="space-y-1">
          <label
            htmlFor="stgm-org-profile-name"
            className="text-xs font-medium text-foreground"
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
              "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
          <p className="text-[0.65rem] text-muted-foreground">
            The display name shown in the sidebar and across the platform.
          </p>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label
            htmlFor="stgm-org-profile-desc"
            className="text-xs font-medium text-foreground"
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
              "w-full resize-y rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
          <p className="text-[0.65rem] text-muted-foreground">
            {description.length}/{DESCRIPTION_MAX_LEN} characters
          </p>
        </div>

        {/* Logo URL */}
        <div className="space-y-1">
          <label
            htmlFor="stgm-org-profile-logo"
            className="text-xs font-medium text-foreground"
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
              "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
          <p className="text-[0.65rem] text-muted-foreground">
            A public URL to your organization&apos;s logo image.
          </p>
          <LogoPreview url={logoUrl.trim()} />
        </div>
      </div>

      {/* -- Error feedback -- */}
      {updateError && (
        <p className="text-destructive text-[0.65rem]" role="alert">
          {getUserMessage(updateError)}
        </p>
      )}

      {/* -- Actions -- */}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isUpdating && <SpinnerIcon />}
          Save changes
        </button>

        {hasChanges && !isUpdating && (
          <button
            type="button"
            onClick={handleDiscard}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
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
      <hr className="border-border" />
      <div className="space-y-2">
        <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">
          Identity Providers
        </p>

        {isLoading ? (
          <div className="bg-muted-subtle h-8 animate-pulse rounded" />
        ) : identityProviders.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No identity providers configured.{" "}
            <a
              href="/settings/identity-providers"
              className="text-primary hover:text-primary-hover underline underline-offset-2"
            >
              Set up federated authentication
            </a>
          </p>
        ) : (
          <div className="space-y-1.5">
            {identityProviders.map((idp) => {
              const spec = idp.spec;
              const displayName =
                spec?.displayName || idp.metadata?.name || "Unnamed";
              const isSso = spec?.isSsoProvider;
              const isJit = !isSso && spec?.autoProvisionAccounts;

              return (
                <div
                  key={idp.metadata?.id}
                  className="flex items-center gap-2 text-xs"
                >
                  <ShieldSmallIcon />
                  <span className="text-foreground truncate">{displayName}</span>
                  {isSso && (
                    <span className="rounded-full border border-primary/30 bg-primary-subtle px-1.5 py-px text-[0.6rem] font-medium text-primary">
                      SSO
                    </span>
                  )}
                  {isJit && (
                    <span className="rounded-full border border-primary/30 bg-primary-subtle px-1.5 py-px text-[0.6rem] font-medium text-primary">
                      JIT
                    </span>
                  )}
                </div>
              );
            })}
            <a
              href="/settings/identity-providers"
              className="inline-block text-[0.65rem] text-primary hover:text-primary-hover underline underline-offset-2"
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
      className="shrink-0 text-muted-foreground"
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
    <div className="space-y-0.5">
      <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-xs text-foreground select-all",
            mono && "font-mono",
          )}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "rounded px-1.5 py-0.5 text-[0.6rem]",
            "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
            "transition-colors",
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
    <div className="mt-2">
      <img
        src={url}
        alt="Organization logo preview"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={cn(
          "h-10 w-10 rounded-md border border-border object-contain bg-background",
          status === "idle" && "opacity-0",
          status === "loaded" && "opacity-100",
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpinnerIcon
// ---------------------------------------------------------------------------

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
