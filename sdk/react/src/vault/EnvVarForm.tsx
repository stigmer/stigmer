"use client";

import { useState, useCallback, useRef, useId, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import type { EnvVarInput } from "./types.js";
import { useScrollShadows } from "../internal/useScrollShadows.js";
import { ScrollFade } from "../internal/ScrollFade.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

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
  /**
   * Whether the values are to be saved in My vault. Always `true` unless
   * the form offers its save toggle (`unsavedScope`) and the person turned
   * it off.
   */
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
   * button shows `"Save"` while the values are to be saved, and otherwise
   * names where the unsaved values are used (`unsavedScope`).
   */
  readonly submitLabel?: string;
  /**
   * Offer the "Save in My vault" toggle, naming where values the person
   * chooses not to save are used: `"connection"`, one connection to a
   * tool, not kept. Omitted, the form has no toggle and always saves: a
   * conversation never keeps values of its own, so a value typed for a
   * chat is saved in My vault.
   */
  readonly unsavedScope?: "connection";
  /**
   * Overrides the default cancel button label (`"Back"`).
   */
  readonly cancelLabel?: string;
  /**
   * Initial state of the "Save in My vault" toggle, when the form offers
   * one (`unsavedScope`).
   * @default true
   */
  readonly defaultSaveForFuture?: boolean;
  /**
   * When `true`, the save toggle is hidden and the form always uses
   * `defaultSaveForFuture` as the submit value. Only meaningful with
   * `unsavedScope`; without it there is no toggle.
   * @default false
   */
  readonly hideSaveToggle?: boolean;
  /**
   * Pre-fill values from another source the host holds.
   *
   * When provided, fields whose keys return a value are pre-populated
   * with it, and a subtle indicator says the value was pre-filled.
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
 * With `unsavedScope`, a "Save in My vault" toggle (on by default) lets
 * the user choose between saving the values in their My vault and using
 * them for one connection only. The toggle state is reported via
 * `onSubmit` so the caller can route to the appropriate codepath.
 * Without it the form always saves.
 *
 * This is a **pure presentational component** with no knowledge of
 * vaults, sessions, or orchestration. It
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
 *   unsavedScope="connection"
 *   onSubmit={(values, { saveForFuture }) => {
 *     if (saveForFuture) saveToMyVault(values);
 *     connect(values);
 *   }}
 *   onCancel={() => console.log("cancelled")}
 * />
 * ```
 */
/** What the form says about values the person chooses not to save. */
const UNSAVED_COPY: Readonly<
  Record<"connection", { readonly submit: string; readonly note: string }>
> = {
  connection: {
    submit: "Use for this connection",
    note: "Used for this connection only. Not saved.",
  },
};

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
  unsavedScope,
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
  // Without a scope for unsaved values there is nowhere else for them to
  // go: the form saves.
  const [saveForFuture, setSaveForFuture] = useState(unsavedScope === undefined ? true : defaultSaveForFuture);
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
    submitLabel ??
    (saveForFuture || unsavedScope === undefined ? "Save" : UNSAVED_COPY[unsavedScope].submit);

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("stg:w-72 stg:space-y-3", className)}
      aria-label={resolvedAriaLabel}
    >
      {/* Header */}
      {title && (
        <div className="stg:space-y-0.5">
          <h3 className="stg:text-xs stg:font-medium stg:text-foreground">{title}</h3>
          {description && (
            <p className="stg:text-[0.65rem] stg:text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      )}

      {/* Fields */}
      <div className="stg:relative">
        {fields.canScrollUp && <ScrollFade position="top" />}

        <div ref={fields.scrollRef} className="stg:max-h-64 stg:space-y-2.5 stg:overflow-y-auto">
          {variables.map((variable, idx) => {
            const inputId = `${instanceId}-env-${variable.key}`;
            const descId = variable.description
              ? `${inputId}-desc`
              : undefined;
            const isRevealed = revealedKeys.has(variable.key);

            return (
              <div key={variable.key} className="stg:space-y-1">
                <label
                  htmlFor={inputId}
                  className="stg:flex stg:items-baseline stg:gap-1.5 stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground"
                >
                  <span className="stg:font-mono">{variable.key}</span>
                  {variable.isSecret && (
                    <span className="stg:text-[0.55rem] stg:uppercase stg:tracking-wider stg:text-muted-foreground-subtle">
                      secret
                    </span>
                  )}
                </label>

                <div className="stg:relative">
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
                      "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
                      "stg:placeholder:text-muted-foreground",
                      "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                      "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                      variable.isSecret && "stg:pr-8",
                    )}
                  />

                  {variable.isSecret && (
                    <button
                      type="button"
                      onClick={() => toggleReveal(variable.key)}
                      disabled={isDisabled}
                      className={cn(
                        "stg:absolute stg:right-2 stg:top-1/2 stg:-translate-y-1/2",
                        "stg:text-muted-foreground stg:hover:text-foreground",
                        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
                    className="stg:text-[0.6rem] stg:leading-relaxed stg:text-muted-foreground-subtle"
                  >
                    {variable.description}
                  </p>
                )}
                {prefilledKeys.has(variable.key) && (
                  <p className="stg:text-[0.55rem] stg:text-primary-muted">
                    Pre-filled
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {fields.canScrollDown && <ScrollFade position="bottom" />}
      </div>

      {/* Save toggle */}
      {unsavedScope !== undefined && !hideSaveToggle && (
        <div className="stg:flex stg:items-start stg:gap-2 stg:pt-0.5">
          <button
            id={toggleId}
            type="button"
            role="switch"
            aria-checked={saveForFuture}
            onClick={() => setSaveForFuture((prev) => !prev)}
            disabled={isDisabled}
            className={cn(
              "stg:relative stg:mt-0.5 stg:inline-flex stg:h-4 stg:w-7 stg:shrink-0 stg:cursor-pointer stg:rounded-full stg:transition-colors",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-2",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              saveForFuture ? "stg:bg-primary" : "stg:bg-input",
            )}
          >
            <span
              className={cn(
                "stg:pointer-events-none stg:block stg:h-3 stg:w-3 stg:translate-y-0.5 stg:rounded-full stg:bg-background stg:shadow-sm stg:ring-0 stg:transition-transform",
                saveForFuture ? "stg:translate-x-3.5" : "stg:translate-x-0.5",
              )}
            />
          </button>
          <label
            htmlFor={toggleId}
            className="stg:cursor-pointer stg:select-none stg:space-y-0.5"
          >
            <span className="stg:block stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground">
              Save in My vault
            </span>
            {!saveForFuture && (
              <span className="stg:block stg:text-[0.6rem] stg:leading-relaxed stg:text-muted-foreground-subtle">
                {UNSAVED_COPY[unsavedScope].note}
              </span>
            )}
          </label>
        </div>
      )}

      {/* Footer */}
      <div className="stg:flex stg:items-center stg:justify-end stg:gap-2 stg:pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isDisabled}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground",
            "stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isSubmitting && <SpinnerIcon size={12} />}
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

