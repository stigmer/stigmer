"use client";

import { useCallback } from "react";
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
 * icon URL, visibility, and the instructions textarea.
 *
 * The slug auto-derives from the name until the user manually edits it.
 * Follows the same pattern as `CreateOrganizationForm`.
 */
export function IdentityStep({
  data,
  updateData,
  validationError,
}: IdentityStepProps) {
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
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Identity & Instructions
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Define what this agent is and what it does.
        </p>
      </div>

      {validationError && (
        <p className="text-sm text-destructive" role="alert">
          {validationError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Name */}
        <div className="space-y-1.5">
          <label
            htmlFor="stgm-wizard-agent-name"
            className="text-sm font-medium text-foreground"
          >
            Name <span className="text-destructive">*</span>
          </label>
          <input
            id="stgm-wizard-agent-name"
            type="text"
            value={data.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. PR Review Bot"
            autoFocus
            className={cn(
              "w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
        </div>

        {/* Slug */}
        <div className="space-y-1.5">
          <label
            htmlFor="stgm-wizard-agent-slug"
            className="text-sm font-medium text-foreground"
          >
            Slug
          </label>
          <input
            id="stgm-wizard-agent-slug"
            type="text"
            value={data.slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="auto-generated"
            className={cn(
              "w-full rounded-md border px-3 py-2 font-mono text-sm text-foreground",
              slugError
                ? "border-destructive bg-input-bg"
                : "border-input bg-input-bg",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
          {slugError && (
            <p className="text-xs text-destructive">{slugError}</p>
          )}
          {!slugError && data.slug && (
            <p className="text-xs text-muted-foreground">
              Referenced as <code className="font-mono">{data.slug}</code>
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label
          htmlFor="stgm-wizard-agent-description"
          className="text-sm font-medium text-foreground"
        >
          Description
        </label>
        <input
          id="stgm-wizard-agent-description"
          type="text"
          value={data.description}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="A brief description of what this agent does"
          maxLength={200}
          className={cn(
            "w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />
      </div>

      {/* Icon URL + Visibility (same row) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label
            htmlFor="stgm-wizard-agent-icon"
            className="text-sm font-medium text-foreground"
          >
            Icon URL
          </label>
          <input
            id="stgm-wizard-agent-icon"
            type="url"
            value={data.iconUrl}
            onChange={(e) => updateData({ iconUrl: e.target.value })}
            placeholder="https://example.com/icon.png"
            className={cn(
              "w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-foreground">
            Visibility
          </legend>
          <div className="flex gap-2">
            <VisibilityOption
              value="private"
              label="Private"
              checked={data.visibility === "private"}
              onChange={() => updateData({ visibility: "private" })}
            />
            <VisibilityOption
              value="public"
              label="Public"
              checked={data.visibility === "public"}
              onChange={() => updateData({ visibility: "public" })}
            />
          </div>
        </fieldset>
      </div>

      {/* Instructions */}
      <div className="space-y-1.5">
        <label
          htmlFor="stgm-wizard-agent-instructions"
          className="text-sm font-medium text-foreground"
        >
          Instructions
        </label>
        <p className="text-xs text-muted-foreground">
          The system prompt that defines this agent&apos;s behavior.
        </p>
        <textarea
          id="stgm-wizard-agent-instructions"
          value={data.instructions}
          onChange={(e) => updateData({ instructions: e.target.value })}
          placeholder="You are a helpful assistant that..."
          rows={12}
          className={cn(
            "w-full resize-y rounded-md border border-input bg-input-bg px-3 py-2 font-mono text-sm text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visibility radio option
// ---------------------------------------------------------------------------

function VisibilityOption({
  value,
  label,
  checked,
  onChange,
}: {
  readonly value: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm transition-colors",
        checked
          ? "border-primary bg-primary-subtle text-primary font-medium"
          : "border-input bg-input-bg text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      <input
        type="radio"
        name="stgm-wizard-agent-visibility"
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {label}
    </label>
  );
}
