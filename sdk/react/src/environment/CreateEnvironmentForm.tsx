"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { useCreateEnvironment } from "./useCreateEnvironment.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

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
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
      <div className="stg:space-y-2">
        <div className="stg:space-y-1">
          <label
            htmlFor="stgm-new-env-name"
            className="stg:text-xs stg:font-medium stg:text-foreground"
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
              "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          />
        </div>

        <div className="stg:space-y-1">
          <label
            htmlFor="stgm-new-env-desc"
            className="stg:text-xs stg:font-medium stg:text-muted-foreground"
          >
            Description{" "}
            <span className="stg:text-muted-foreground-subtle">(optional)</span>
          </label>
          <input
            id="stgm-new-env-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this environment for?"
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
          Create environment
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

