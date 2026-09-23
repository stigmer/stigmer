"use client";

import { useCallback, useId } from "react";
import { cn } from "@stigmer/theme";
import { generateSlug } from "../../internal/slug.js";
import type { AgentWizardData } from "./types.js";

/** Props for {@link IdentityStep}. */
export interface IdentityStepProps {
  readonly data: AgentWizardData;
  readonly updateData: (partial: Partial<AgentWizardData>) => void;
  readonly validationError: string | null;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Wizard step 1: Agent identity and instructions.
 *
 * Collects: name (required), slug (auto-derived), description,
 * icon URL, and the instructions textarea. Visibility is not chosen
 * here: a new agent takes its kind's default level, and the detail
 * page's `ResourceVisibilityControl` is the one home of the choice.
 *
 * The slug auto-derives from the name until the user manually edits it.
 * Follows the same pattern as `CreateOrganizationForm`.
 */
export function IdentityStep({
  data,
  updateData,
  validationError,
}: IdentityStepProps) {
  const baseId = useId();
  const handleNameChange = useCallback(
    (value: string) => {
      if (!data.slugTouched) {
        updateData({ name: value, slug: generateSlug(value) });
      } else {
        updateData({ name: value });
      }
    },
    [data.slugTouched, updateData],
  );

  const handleSlugChange = useCallback(
    (value: string) => {
      updateData({ slug: value, slugTouched: true });
    },
    [updateData],
  );

  const slugError =
    data.slug.length > 0 && !SLUG_PATTERN.test(data.slug)
      ? "Slug must be lowercase letters, numbers, and hyphens only"
      : null;

  return (
    <div className="stg:flex stg:flex-col stg:gap-6">
      <div>
        <h2 className="stg:text-lg stg:font-semibold stg:text-foreground">
          Identity & Instructions
        </h2>
        <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">
          Define what this agent is and what it does.
        </p>
      </div>

      {validationError && (
        <p className="stg:text-sm stg:text-destructive" role="alert">
          {validationError}
        </p>
      )}

      <div className="stg:grid stg:gap-4 stg:sm:grid-cols-2">
        {/* Name */}
        <div className="stg:space-y-1.5">
          <label
            htmlFor={`${baseId}-name`}
            className="stg:text-sm stg:font-medium stg:text-foreground"
          >
            Name <span className="stg:text-destructive">*</span>
          </label>
          <input
            id={`${baseId}-name`}
            type="text"
            value={data.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. PR Review Bot"
            autoFocus
            className={cn(
              "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          />
        </div>

        {/* Slug */}
        <div className="stg:space-y-1.5">
          <label
            htmlFor={`${baseId}-slug`}
            className="stg:text-sm stg:font-medium stg:text-foreground"
          >
            Slug
          </label>
          <input
            id={`${baseId}-slug`}
            type="text"
            value={data.slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="auto-generated"
            className={cn(
              "stg:w-full stg:rounded-md stg:border stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
              slugError
                ? "stg:border-destructive stg:bg-input-bg"
                : "stg:border-input stg:bg-input-bg",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          />
          {slugError && (
            <p className="stg:text-xs stg:text-destructive">{slugError}</p>
          )}
          {!slugError && data.slug && (
            <p className="stg:text-xs stg:text-muted-foreground">
              Referenced as <code className="stg:font-mono">{data.slug}</code>
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="stg:space-y-1.5">
        <label
          htmlFor={`${baseId}-description`}
          className="stg:text-sm stg:font-medium stg:text-foreground"
        >
          Description
        </label>
        <input
          id={`${baseId}-description`}
          type="text"
          value={data.description}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="A brief description of what this agent does"
          maxLength={200}
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        />
      </div>

      {/* Icon URL */}
      <div className="stg:space-y-1.5">
        <label
          htmlFor={`${baseId}-icon`}
          className="stg:text-sm stg:font-medium stg:text-foreground"
        >
          Icon URL
        </label>
        <input
          id={`${baseId}-icon`}
          type="url"
          value={data.iconUrl}
          onChange={(e) => updateData({ iconUrl: e.target.value })}
          placeholder="https://example.com/icon.png"
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        />
      </div>

      {/* Instructions */}
      <div className="stg:space-y-1.5">
        <label
          htmlFor={`${baseId}-instructions`}
          className="stg:text-sm stg:font-medium stg:text-foreground"
        >
          Instructions
        </label>
        <p className="stg:text-xs stg:text-muted-foreground">
          The system prompt that defines this agent&apos;s behavior.
        </p>
        <textarea
          id={`${baseId}-instructions`}
          value={data.instructions}
          onChange={(e) => updateData({ instructions: e.target.value })}
          placeholder="You are a helpful assistant that..."
          rows={12}
          className={cn(
            "stg:w-full stg:resize-y stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        />
      </div>
    </div>
  );
}
