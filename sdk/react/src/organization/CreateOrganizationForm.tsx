"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { create as createMessage } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { useCreateOrganization } from "./useCreateOrganization.js";
import { generateSlug } from "../internal/slug.js";
import { validateMessage, getFieldError } from "../internal/validate.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

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

  const violations =
    slug.length > 0 || trimmedName.length > 0
      ? validateMessage(
          ApiResourceMetadataSchema,
          createMessage(ApiResourceMetadataSchema, {
            ...(slug.length > 0 && { slug }),
            ...(trimmedName.length > 0 && { name: trimmedName }),
          }),
        )
      : [];
  const slugError = slug.length > 0 ? getFieldError(violations, "slug") : null;
  const nameError =
    trimmedName.length > 0 ? getFieldError(violations, "name") : null;
  const canSubmit =
    trimmedName !== "" &&
    slug.length > 0 &&
    slugError === null &&
    nameError === null &&
    !isCreating;

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
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
      <div className="stg:space-y-2">
        {/* ---- Name ---- */}
        <div className="stg:space-y-1">
          <label
            htmlFor="stgm-new-org-name"
            className="stg:text-xs stg:font-medium stg:text-foreground"
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
            maxLength={63}
            className={cn(
              "stg:w-full stg:rounded-md stg:border stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              nameError ? "stg:border-destructive" : "stg:border-input",
            )}
          />
          {nameError ? (
            <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
              {nameError}
            </p>
          ) : (
            <p className="stg:text-[0.65rem] stg:text-muted-foreground">
              A human-readable display name for the organization.
            </p>
          )}
        </div>

        {/* ---- Slug ---- */}
        <div className="stg:space-y-1">
          <label
            htmlFor="stgm-new-org-slug"
            className="stg:text-xs stg:font-medium stg:text-foreground"
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
              "stg:w-full stg:rounded-md stg:border stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground stg:font-mono",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              slugError
                ? "stg:border-destructive"
                : "stg:border-input",
            )}
          />
          {slugError ? (
            <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
              {slugError}
            </p>
          ) : (
            <p className="stg:text-[0.65rem] stg:text-muted-foreground">
              URL-friendly identifier used in resource references. 2&ndash;63
              characters: lowercase letters, numbers, and hyphens.
            </p>
          )}
        </div>

        {/* ---- Description ---- */}
        <div className="stg:space-y-1">
          <label
            htmlFor="stgm-new-org-desc"
            className="stg:text-xs stg:font-medium stg:text-muted-foreground"
          >
            Description{" "}
            <span className="stg:text-muted-foreground-subtle">(optional)</span>
          </label>
          <input
            id="stgm-new-org-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this organization for?"
            disabled={isCreating}
            className={cn(
              "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          />
        </div>
      </div>

      {error && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

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
          {isCreating && <SpinnerIcon size={12} />}
          Create organization
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

