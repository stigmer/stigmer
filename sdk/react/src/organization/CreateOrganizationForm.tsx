"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useCreateOrganization } from "./useCreateOrganization";
import { generateSlug } from "../internal/slug";

// ---------------------------------------------------------------------------
// Slug validation (mirrors Organization proto CEL rules)
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
const SLUG_MIN = 2;
const SLUG_MAX = 15;

function validateSlug(slug: string): string | null {
  if (slug.length === 0) return "Slug is required.";
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX)
    return `Must be between ${SLUG_MIN} and ${SLUG_MAX} characters.`;
  if (!/^[a-z]/.test(slug)) return "Must start with a lowercase letter.";
  if (!SLUG_PATTERN.test(slug))
    return "Only lowercase letters, numbers, and hyphens are allowed.";
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link CreateOrganizationForm}. */
export interface CreateOrganizationFormProps {
  /** Fired with the newly created organization after a successful creation. */
  readonly onCreated?: (org: Organization) => void;
  /** Fired when the user cancels. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Compact form for creating a new {@link Organization} resource.
 *
 * Collects a name, auto-generates a URL-friendly slug, and accepts an
 * optional description. The slug is derived from the name by default
 * but can be manually overridden. It is sent to the server as both
 * `metadata.slug` and `metadata.org` (organizations are self-owning).
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <CreateOrganizationForm
 *   onCreated={(org) => console.log("Created:", org.metadata?.slug)}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function CreateOrganizationForm({
  onCreated,
  onCancel,
  className,
}: CreateOrganizationFormProps) {
  const { create, isCreating, error, clearError } = useCreateOrganization();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");

  // Once the user manually edits the slug field, stop auto-deriving.
  const slugTouchedRef = useRef(false);

  const trimmedName = name.trim();
  const slugError = slug.length > 0 ? validateSlug(slug) : null;
  const canSubmit =
    trimmedName !== "" && slug.length > 0 && slugError === null && !isCreating;

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (!slugTouchedRef.current) {
        setSlug(generateSlug(value.trim()));
      }
    },
    [],
  );

  const handleSlugChange = useCallback((value: string) => {
    slugTouchedRef.current = true;
    setSlug(value);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const org = await create({
          name: trimmedName,
          slug,
          org: slug,
          description: description.trim() || undefined,
        });
        onCreated?.(org);
      } catch {
        // error state is managed by useCreateOrganization
      }
    },
    [canSubmit, trimmedName, slug, description, create, clearError, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-3", className)}>
      <div className="space-y-2">
        {/* ---- Name ---- */}
        <div className="space-y-1">
          <label
            htmlFor="stgm-new-org-name"
            className="text-xs font-medium text-foreground"
          >
            Name
          </label>
          <input
            id="stgm-new-org-name"
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Acme Corp"
            disabled={isCreating}
            autoFocus
            required
            className={cn(
              "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
          <p className="text-[0.65rem] text-muted-foreground">
            A human-readable display name for the organization.
          </p>
        </div>

        {/* ---- Slug ---- */}
        <div className="space-y-1">
          <label
            htmlFor="stgm-new-org-slug"
            className="text-xs font-medium text-foreground"
          >
            Slug
          </label>
          <input
            id="stgm-new-org-slug"
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="e.g. acme-corp"
            disabled={isCreating}
            required
            className={cn(
              "w-full rounded-md border bg-background px-2.5 py-1.5 text-xs text-foreground font-mono",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
              slugError
                ? "border-destructive"
                : "border-input",
            )}
          />
          {slugError ? (
            <p className="text-[0.65rem] text-destructive" role="alert">
              {slugError}
            </p>
          ) : (
            <p className="text-[0.65rem] text-muted-foreground">
              URL-friendly identifier used in resource references.{" "}
              {SLUG_MIN}&ndash;{SLUG_MAX} characters: lowercase letters, numbers, and
              hyphens.
            </p>
          )}
        </div>

        {/* ---- Description ---- */}
        <div className="space-y-1">
          <label
            htmlFor="stgm-new-org-desc"
            className="text-xs font-medium text-muted-foreground"
          >
            Description{" "}
            <span className="text-muted-foreground-subtle">(optional)</span>
          </label>
          <input
            id="stgm-new-org-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this organization for?"
            disabled={isCreating}
            className={cn(
              "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
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
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon />}
          Create organization
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
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
// Icons
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
