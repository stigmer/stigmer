"use client";

import { useState, useCallback, useRef, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import type { EnvVarInput } from "@stigmer/sdk";

/**
 * Describes a single environment variable that the form should collect.
 *
 * Typically derived from an agent's `env_spec.data` entries. The caller
 * is responsible for filtering out variables the user has already provided
 * (i.e. only pass the *missing* variables).
 */
export interface AgentEnvFormVariable {
  /** Environment variable key (e.g. `GITHUB_TOKEN`). Used as label. */
  readonly key: string;
  /** When true, the input renders as a password field with a visibility toggle. */
  readonly isSecret: boolean;
  /** Help text shown below the input. From the agent's env_spec description. */
  readonly description?: string;
}

export interface AgentEnvFormProps {
  /** Agent display name shown in the form header. */
  readonly agentName: string;
  /**
   * Variables to collect. Each entry renders one input field, in order.
   * Must contain at least one variable.
   */
  readonly variables: AgentEnvFormVariable[];
  /**
   * Called with the collected values when the user submits the form.
   * Each value includes `isSecret` from the variable spec so the caller
   * can pass the result directly to environment mutation APIs.
   */
  readonly onSubmit: (values: Record<string, EnvVarInput>) => void;
  /** Called when the user clicks the back/cancel button. */
  readonly onCancel?: () => void;
  /** When true, the submit button shows a spinner and inputs are disabled. */
  readonly isSubmitting?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Compact form that collects environment variable values for an agent.
 *
 * Renders one labeled input per variable from the agent's `env_spec`.
 * Secret variables use a password field with a visibility toggle.
 * The form validates that all fields are non-empty before allowing
 * submission.
 *
 * This is a **pure presentational component** with no knowledge of
 * personal environments, agent instances, or orchestration. It can
 * be used standalone by platform builders for their own env setup UIs,
 * or composed by higher-level hooks like {@link useAgentSetup} within
 * the {@link SessionComposer}.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <AgentEnvForm
 *   agentName="GitHub Reviewer"
 *   variables={[
 *     { key: "GITHUB_TOKEN", isSecret: true, description: "Personal access token" },
 *     { key: "REPO_OWNER", isSecret: false },
 *   ]}
 *   onSubmit={(values) => console.log(values)}
 *   onCancel={() => console.log("cancelled")}
 * />
 * ```
 */
export function AgentEnvForm({
  agentName,
  variables,
  onSubmit,
  onCancel,
  isSubmitting,
  disabled,
  className,
}: AgentEnvFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(variables.map((v) => [v.key, ""])),
  );
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const firstInputRef = useRef<HTMLInputElement>(null);

  const isDisabled = disabled || isSubmitting;

  const allFilled = variables.every((v) => values[v.key]?.trim() !== "");

  const handleChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleReveal = useCallback((key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!allFilled || isDisabled) return;

      const result: Record<string, EnvVarInput> = {};
      for (const variable of variables) {
        result[variable.key] = {
          value: values[variable.key],
          isSecret: variable.isSecret,
          ...(variable.description && { description: variable.description }),
        };
      }
      onSubmit(result);
    },
    [allFilled, isDisabled, values, variables, onSubmit],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("w-72 space-y-3", className)}
      aria-label={`Configure ${agentName}`}
    >
      {/* Header */}
      <div className="space-y-0.5">
        <h3 className="text-xs font-medium text-foreground">{agentName}</h3>
        <p className="text-[0.65rem] text-muted-foreground">
          Enter required credentials to use this agent.
        </p>
      </div>

      {/* Fields */}
      <div className="space-y-2.5">
        {variables.map((variable, idx) => {
          const inputId = `stgm-env-${variable.key}`;
          const descId = variable.description
            ? `${inputId}-desc`
            : undefined;
          const isRevealed = revealedKeys.has(variable.key);

          return (
            <div key={variable.key} className="space-y-1">
              <label
                htmlFor={inputId}
                className="flex items-baseline gap-1.5 text-[0.65rem] font-medium text-muted-foreground"
              >
                <span className="font-mono">{variable.key}</span>
                {variable.isSecret && (
                  <span className="text-[0.55rem] uppercase tracking-wider text-muted-foreground/70">
                    secret
                  </span>
                )}
              </label>

              <div className="relative">
                <input
                  ref={idx === 0 ? firstInputRef : undefined}
                  id={inputId}
                  type={
                    variable.isSecret && !isRevealed ? "password" : "text"
                  }
                  value={values[variable.key]}
                  onChange={(e) => handleChange(variable.key, e.target.value)}
                  disabled={isDisabled}
                  required
                  aria-required
                  aria-describedby={descId}
                  autoComplete="off"
                  autoFocus={idx === 0}
                  className={cn(
                    "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
                    "placeholder:text-muted-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "disabled:pointer-events-none disabled:opacity-50",
                    variable.isSecret && "pr-8",
                  )}
                />

                {variable.isSecret && (
                  <button
                    type="button"
                    onClick={() => toggleReveal(variable.key)}
                    disabled={isDisabled}
                    className={cn(
                      "absolute right-2 top-1/2 -translate-y-1/2",
                      "text-muted-foreground hover:text-foreground",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                    aria-label={
                      isRevealed ? `Hide ${variable.key}` : `Show ${variable.key}`
                    }
                    tabIndex={-1}
                  >
                    {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                )}
              </div>

              {variable.description && (
                <p
                  id={descId}
                  className="text-[0.6rem] leading-relaxed text-muted-foreground/80"
                >
                  {variable.description}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isDisabled}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Back
          </button>
        )}

        <button
          type="submit"
          disabled={!allFilled || isDisabled}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground",
            "hover:bg-primary/90",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isSubmitting && <SpinnerIcon />}
          Save
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function EyeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.59 6.59a2 2 0 0 0 2.82 2.82" />
      <path d="M10.73 10.73A6.5 6.5 0 0 1 8 12.5c-4 0-6.5-4.5-6.5-4.5a11.5 11.5 0 0 1 3.77-3.73" />
      <path d="M5.71 3.56A6.3 6.3 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11.5 11.5 0 0 1-1.28 1.73" />
      <path d="M2 2l12 12" />
    </svg>
  );
}

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
