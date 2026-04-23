"use client";

import { useState, useCallback, useRef, useId, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import type { EnvVarInput } from "@stigmer/sdk";
import { useScrollShadows } from "../internal/useScrollShadows";
import { ScrollFade } from "../internal/ScrollFade";

/**
 * Describes a single environment variable the form should collect.
 *
 * Typically derived from a resource's `env` entries (Agent,
 * McpServer, or any resource that declares required environment
 * variables). The caller is responsible for filtering out variables
 * the user has already provided (i.e. only pass the *missing* ones).
 */
export interface EnvVarFormVariable {
  /** Environment variable key (e.g. `GITHUB_TOKEN`). Used as label. */
  readonly key: string;
  /** When true, the input renders as a password field with a visibility toggle. */
  readonly isSecret: boolean;
  /** Help text shown below the input. From the resource's env declaration description. */
  readonly description?: string;
  /**
   * When true, this variable is not required for the resource to function.
   * Callers can use this to filter optional vars out of forms or to show
   * them separately from required vars.
   */
  readonly optional?: boolean;
}

/** Options reported by the form alongside the collected values on submit. */
export interface EnvVarFormSubmitOptions {
  /** Whether the user chose to save these values for future runs. */
  readonly saveForFuture: boolean;
}

/** Props for {@link EnvVarForm}. */
export interface EnvVarFormProps {
  /**
   * Variables to collect. Each entry renders one input field, in order.
   * Must contain at least one variable.
   */
  readonly variables: EnvVarFormVariable[];
  /**
   * Called with the collected values and the save toggle state when
   * the user submits the form.
   */
  readonly onSubmit: (
    values: Record<string, EnvVarInput>,
    options: EnvVarFormSubmitOptions,
  ) => void;
  /** Called when the user clicks the cancel/back button. */
  readonly onCancel?: () => void;
  /** When true, the submit button shows a spinner and inputs are disabled. */
  readonly isSubmitting?: boolean;
  /** When `true`, all inputs and buttons are disabled. */
  readonly disabled?: boolean;

  /**
   * Optional heading rendered above the fields. When omitted, no
   * header section is rendered — useful when the form is embedded
   * inside a panel that provides its own header.
   */
  readonly title?: string;
  /**
   * Subtitle shown below the title. Only rendered when `title` is
   * also provided.
   */
  readonly description?: string;

  /**
   * Overrides the default submit button label. When omitted, the
   * button dynamically shows `"Save"` or `"Use once"` based on the
   * save-for-future toggle state.
   */
  readonly submitLabel?: string;
  /**
   * Overrides the default cancel button label (`"Back"`).
   */
  readonly cancelLabel?: string;
  /**
   * Initial state of the "Save for future runs" toggle.
   * Platform builders can override this to match their default
   * secret-persistence policy.
   * @default true
   */
  readonly defaultSaveForFuture?: boolean;
  /**
   * When `true`, the save toggle is hidden and the form always uses
   * `defaultSaveForFuture` as the submit value. Useful for platform
   * builders who want to enforce a single persistence policy.
   * @default false
   */
  readonly hideSaveToggle?: boolean;
  /**
   * Pre-fill values from the session env pool.
   *
   * When provided, fields whose keys are in this record are
   * pre-populated with the pool's value. A subtle indicator shows
   * that the value was provided by another source in the session.
   *
   * Platform builders who use `useSessionEnvPool` can pass
   * `pool.getAvailableValue` to look up pre-fill values.
   */
  readonly poolValues?: (key: string) => EnvVarInput | undefined;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Overrides the `aria-label` on the `<form>` element. When omitted,
   * falls back to `"Configure {title}"` if a title is provided, or
   * `"Configure environment variables"` as a generic fallback.
   */
  readonly ariaLabel?: string;
}

/**
 * Compact form that collects environment variable values for any
 * resource that declares `env` variables (Agents, MCP servers, etc.).
 *
 * Renders one labeled input per variable. Secret variables use a
 * password field with a visibility toggle. The form validates that
 * all fields are non-empty before allowing submission.
 *
 * A "Save for future runs" toggle (on by default) lets the user
 * choose between persisting secrets to their personal environment
 * or using them for a single execution only. The toggle state is
 * reported via `onSubmit` so the caller can route to the
 * appropriate codepath.
 *
 * This is a **pure presentational component** with no knowledge of
 * personal environments, resource instances, or orchestration. It
 * can be used standalone by platform builders for their own env
 * setup UIs, or composed by higher-level hooks like
 * {@link useAgentSetup} or `useMcpServerSetup` within the
 * {@link SessionComposer}.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <EnvVarForm
 *   title="GitHub MCP Server"
 *   description="Enter required credentials."
 *   variables={[
 *     { key: "GITHUB_TOKEN", isSecret: true, description: "Personal access token" },
 *     { key: "REPO_OWNER", isSecret: false },
 *   ]}
 *   onSubmit={(values, { saveForFuture }) => {
 *     if (saveForFuture) saveToEnvironment(values);
 *     else useAsRuntimeEnv(values);
 *   }}
 *   onCancel={() => console.log("cancelled")}
 * />
 * ```
 */
export function EnvVarForm({
  variables,
  onSubmit,
  onCancel,
  isSubmitting,
  disabled,
  title,
  description,
  submitLabel,
  cancelLabel = "Back",
  defaultSaveForFuture = true,
  hideSaveToggle = false,
  poolValues,
  className,
  ariaLabel,
}: EnvVarFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      variables.map((v) => {
        const poolVal = poolValues?.(v.key);
        return [v.key, poolVal?.value ?? ""];
      }),
    ),
  );
  const [prefilledKeys] = useState<Set<string>>(() => {
    if (!poolValues) return new Set<string>();
    const keys = new Set<string>();
    for (const v of variables) {
      if (poolValues(v.key)) keys.add(v.key);
    }
    return keys;
  });
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [saveForFuture, setSaveForFuture] = useState(defaultSaveForFuture);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const fields = useScrollShadows();

  const instanceId = useId();
  const toggleId = `${instanceId}-save-toggle`;

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
      onSubmit(result, { saveForFuture });
    },
    [allFilled, isDisabled, values, variables, onSubmit, saveForFuture],
  );

  const resolvedAriaLabel =
    ariaLabel ?? (title ? `Configure ${title}` : "Configure environment variables");

  const resolvedSubmitLabel =
    submitLabel ?? (saveForFuture ? "Save" : "Use once");

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("w-72 space-y-3", className)}
      aria-label={resolvedAriaLabel}
    >
      {/* Header */}
      {title && (
        <div className="space-y-0.5">
          <h3 className="text-xs font-medium text-foreground">{title}</h3>
          {description && (
            <p className="text-[0.65rem] text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      )}

      {/* Fields */}
      <div className="relative">
        {fields.canScrollUp && <ScrollFade position="top" />}

        <div ref={fields.scrollRef} className="max-h-64 space-y-2.5 overflow-y-auto">
          {variables.map((variable, idx) => {
            const inputId = `${instanceId}-env-${variable.key}`;
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
                    <span className="text-[0.55rem] uppercase tracking-wider text-muted-foreground-subtle">
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
                    className="text-[0.6rem] leading-relaxed text-muted-foreground-subtle"
                  >
                    {variable.description}
                  </p>
                )}
                {prefilledKeys.has(variable.key) && (
                  <p className="text-[0.55rem] text-primary-muted">
                    Pre-filled from session variables
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {fields.canScrollDown && <ScrollFade position="bottom" />}
      </div>

      {/* Save toggle */}
      {!hideSaveToggle && (
        <div className="flex items-start gap-2 pt-0.5">
          <button
            id={toggleId}
            type="button"
            role="switch"
            aria-checked={saveForFuture}
            onClick={() => setSaveForFuture((prev) => !prev)}
            disabled={isDisabled}
            className={cn(
              "relative mt-0.5 inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:pointer-events-none disabled:opacity-50",
              saveForFuture ? "bg-primary" : "bg-input",
            )}
          >
            <span
              className={cn(
                "pointer-events-none block h-3 w-3 translate-y-0.5 rounded-full bg-background shadow-sm ring-0 transition-transform",
                saveForFuture ? "translate-x-3.5" : "translate-x-0.5",
              )}
            />
          </button>
          <label
            htmlFor={toggleId}
            className="cursor-pointer select-none space-y-0.5"
          >
            <span className="block text-[0.65rem] font-medium text-muted-foreground">
              Save for future runs
            </span>
            {!saveForFuture && (
              <span className="block text-[0.6rem] leading-relaxed text-muted-foreground-subtle">
                These values will only be used for this run.
              </span>
            )}
          </label>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isDisabled}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {cancelLabel}
          </button>
        )}

        <button
          type="submit"
          disabled={!allFilled || isDisabled}
          data-cursor-target="env-form-submit"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground",
            "hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isSubmitting && <SpinnerIcon />}
          {resolvedSubmitLabel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Icons (internal to this module)
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
