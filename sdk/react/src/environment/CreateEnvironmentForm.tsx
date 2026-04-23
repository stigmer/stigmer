"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { useCreateEnvironment } from "./useCreateEnvironment";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link CreateEnvironmentForm}. */
export interface CreateEnvironmentFormProps {
  /** Organization slug. Used as the `org` field when creating the environment. */
  readonly org: string;
  /** Fired with the newly created environment after a successful creation. */
  readonly onCreated?: (env: Environment) => void;
  /** Fired when the user cancels. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Compact form for creating a new {@link Environment} resource.
 *
 * Collects a name and optional description, then creates the
 * environment via `useCreateEnvironment`. Variables can be added
 * after creation through the {@link EnvironmentVariableEditor}.
 *
 * Part of the **Environment Flow** — creates persistent credential
 * stores. All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <CreateEnvironmentForm
 *   org="acme"
 *   onCreated={(env) => console.log("Created:", env.metadata?.slug)}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function CreateEnvironmentForm({
  org,
  onCreated,
  onCancel,
  className,
}: CreateEnvironmentFormProps) {
  const { create, isCreating, error, clearError } = useCreateEnvironment();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const trimmedName = name.trim();
  const canSubmit = trimmedName !== "" && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const env = await create({
          name: trimmedName,
          org,
          description: description.trim() || undefined,
        });
        onCreated?.(env);
      } catch {
        // error state is managed by useCreateEnvironment
      }
    },
    [canSubmit, trimmedName, org, description, create, clearError, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-3", className)}>
      <div className="space-y-2">
        <div className="space-y-1">
          <label
            htmlFor="stgm-new-env-name"
            className="text-xs font-medium text-foreground"
          >
            Name
          </label>
          <input
            id="stgm-new-env-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. production-keys"
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
        </div>

        <div className="space-y-1">
          <label
            htmlFor="stgm-new-env-desc"
            className="text-xs font-medium text-muted-foreground"
          >
            Description{" "}
            <span className="text-muted-foreground-subtle">(optional)</span>
          </label>
          <input
            id="stgm-new-env-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this environment for?"
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
          Create environment
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
