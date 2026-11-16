"use client";

import { type FormEvent, useCallback, useId, useRef, useState } from "react";
import { create as createMessage } from "@bufbuild/protobuf";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { useCreateOrganization } from "./useCreateOrganization.js";
import { generateSlug } from "../internal/slug.js";
import { validateMessage, getFieldError } from "../internal/validate.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Button } from "../button/Button.js";
import { FIELD_LABEL_CLASSES, FieldError, TextInput } from "../internal/form/index.js";

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
 * but can be manually overridden. It is sent as `metadata.slug`; the
 * server gives the new organization its permanent id, and an organization
 * belongs to no organization, so `metadata.org` stays unset.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * function NewOrganization({ onOpen, onClose }: { onOpen: (href: string) => void; onClose: () => void }) {
 *   return <CreateOrganizationForm onCreated={(org) => onOpen(`/${org.metadata?.slug}`)} onCancel={onClose} />;
 * }
 * ```
 */
export function CreateOrganizationForm({
  onCreated,
  onCancel,
  className,
}: CreateOrganizationFormProps) {
  const baseId = useId();
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
            htmlFor={`${baseId}-name`}
            className={FIELD_LABEL_CLASSES}
          >
            Name
          </label>
          <TextInput
            id={`${baseId}-name`}
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Acme Corp"
            disabled={isCreating}
            autoFocus
            required
            maxLength={63} className="stg:w-full" invalid={Boolean(nameError)}
          />
          {nameError ? (
            <FieldError>
              {nameError}
            </FieldError>
          ) : (
            <p className="stg:text-2xs stg:text-muted-foreground">
              A human-readable display name for the organization.
            </p>
          )}
        </div>

        {/* ---- Slug ---- */}
        <div className="stg:space-y-1">
          <label
            htmlFor={`${baseId}-slug`}
            className={FIELD_LABEL_CLASSES}
          >
            Slug
          </label>
          <TextInput
            id={`${baseId}-slug`}
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="e.g. acme-corp"
            disabled={isCreating}
            required className="stg:w-full stg:font-mono" invalid={Boolean(slugError)}
          />
          {slugError ? (
            <FieldError>
              {slugError}
            </FieldError>
          ) : (
            <p className="stg:text-2xs stg:text-muted-foreground">
              URL-friendly identifier used in resource references. 2&ndash;63
              characters: lowercase letters, numbers, and hyphens.
            </p>
          )}
        </div>

        {/* ---- Description ---- */}
        <div className="stg:space-y-1">
          <label
            htmlFor={`${baseId}-desc`}
            className={FIELD_LABEL_CLASSES}
          >
            Description{" "}
            <span className="stg:text-muted-foreground-subtle">(optional)</span>
          </label>
          <TextInput
            id={`${baseId}-desc`}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this organization for?"
            disabled={isCreating} className="stg:w-full"
          />
        </div>
      </div>

      {error && (
        <FieldError>
          {getUserMessage(error)}
        </FieldError>
      )}

      <div className="stg:flex stg:items-center stg:gap-2">
        <Button type="submit" disabled={!canSubmit} icon={isCreating ? <SpinnerIcon size={12} /> : undefined}>
          Create organization
        </Button>

        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={isCreating}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

