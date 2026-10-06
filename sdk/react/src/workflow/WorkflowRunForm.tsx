"use client";

/**
 * The fields of the run dialog: one input per key the workflow declares,
 * each marked with where its value will come from (typed here and passed
 * with the run, the person's personal environment, or missing) or that it
 * is not yet known (the personal environment still being checked, or
 * unreadable), a notice when the workflow's runs are visible to its
 * organization, and the trigger input.
 *
 * Presentational only; {@link useRunWorkflowFlow} supplies the state.
 * Pinned through the dialog by `__tests__/WorkflowRunDialog.test.tsx`.
 */

import { useId } from "react";
import { cn } from "@stigmer/theme";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { RunWorkflowFieldErrors } from "./useRunWorkflowFlow.js";
import type { RunEnvKeySource } from "./useRunEnvKeySources.js";

/** Props for {@link WorkflowRunForm}. */
export interface WorkflowRunFormProps {
  /** Current trigger message value. */
  readonly triggerMessage: string;
  /** Called when the trigger message changes. */
  readonly onTriggerMessageChange: (value: string) => void;

  /** Declared environment variables from the workflow spec. */
  readonly envDeclarations: Record<string, EnvVarDeclaration>;
  /** Current runtime env var overrides (keyed by variable name). */
  readonly runtimeEnv: Record<string, string>;
  /** Called when a single env var value changes. */
  readonly onEnvVarChange: (key: string, value: string) => void;

  /**
   * Where each declared key's value will come from, keyed by key name
   * ({@link useRunWorkflowFlow}'s `envKeySources`). A key held by the
   * personal environment is shown as an optional override; a key whose
   * source is `pending` or `unknown` is not marked required, since the
   * personal environment may hold it; a key with no entry carries no
   * marker.
   */
  readonly envKeySources?: Readonly<Record<string, RunEnvKeySource>>;

  /**
   * When `true`, a notice says that every run of this workflow is visible
   * to its organization, this run's input and output included.
   */
  readonly runsVisibleToOrganization?: boolean;

  /**
   * Whether to show the trigger message field.
   * When `false`, a subtle "Add trigger input" toggle is rendered instead.
   */
  readonly showTriggerMessage: boolean;
  /** Called when the user toggles trigger message visibility. */
  readonly onShowTriggerMessageChange: (show: boolean) => void;

  /** Field-level validation errors keyed by field name. */
  readonly errors: RunWorkflowFieldErrors;

  /** When `true`, all fields are disabled (during submission). */
  readonly disabled?: boolean;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

const INPUT_CLASSES = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-sm stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

/**
 * Form fields for running a workflow run.
 *
 * Renders auto-generated environment variable fields from the workflow's
 * `spec.env` declarations, each marked with its source, and a
 * conditionally-visible trigger message textarea.
 *
 * Field ordering prioritizes required inputs (env vars) over optional
 * contextual fields (trigger message), following progressive disclosure.
 *
 * This component is presentational — it does not manage state or
 * submit. Pair with {@link useRunWorkflowFlow} for the full
 * behavior, or wire the props manually for custom integrations.
 *
 * All visuals flow through `--stgm-*` design tokens. Zero Console
 * dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const flow = useRunWorkflowFlow({ ... });
 *
 * <WorkflowRunForm
 *   triggerMessage={flow.triggerMessage}
 *   onTriggerMessageChange={flow.setTriggerMessage}
 *   envDeclarations={flow.envDeclarations}
 *   runtimeEnv={flow.runtimeEnv}
 *   onEnvVarChange={flow.setEnvVar}
 *   envKeySources={flow.envKeySources}
 *   runsVisibleToOrganization={flow.runsVisibleToOrganization}
 *   showTriggerMessage={flow.showTriggerMessage}
 *   onShowTriggerMessageChange={flow.setShowTriggerMessage}
 *   errors={flow.fieldErrors}
 *   disabled={flow.isSubmitting}
 * />
 * ```
 */
export function WorkflowRunForm({
  triggerMessage,
  onTriggerMessageChange,
  envDeclarations,
  runtimeEnv,
  onEnvVarChange,
  envKeySources,
  runsVisibleToOrganization = false,
  showTriggerMessage,
  onShowTriggerMessageChange,
  errors,
  disabled,
  className,
}: WorkflowRunFormProps) {
  const formId = useId();
  const envEntries = Object.entries(envDeclarations);

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
      {/* Said before the run starts: the run joins an org-visible history. */}
      {runsVisibleToOrganization && (
        <p
          role="note"
          className="stg:rounded-md stg:border stg:border-border stg:bg-muted stg:px-3 stg:py-2 stg:text-xs stg:text-foreground"
        >
          Every run of this workflow is visible to everyone in its
          organization. This run&apos;s input and output will be visible to
          them too.
        </p>
      )}

      {/* Environment variables */}
      {envEntries.length > 0 && (
        <div className="stg:flex stg:flex-col stg:gap-3">
          <h4 className="stg:text-xs stg:font-medium stg:text-muted-foreground">
            Environment Variables
          </h4>
          {envEntries.map(([key, decl]) => {
            const fieldId = `${formId}-env-${key}`;
            const fieldError = errors[key];
            const source = envKeySources?.[key];
            const fromPersonal = source === "personal";
            const mayBePersonal = source === "pending" || source === "unknown";
            const isRequired = !decl.optional && !fromPersonal && !mayBePersonal;
            const unreadable = source === "unknown";
            const hasHint = fromPersonal || unreadable || !!decl.description;
            return (
              <FieldGroup key={key}>
                <div className="stg:flex stg:items-center">
                  <FieldLabel htmlFor={fieldId}>
                    <code className="stg:text-xs">{key}</code>
                    {isRequired && (
                      <span
                        className="stg:ml-1 stg:text-destructive"
                        aria-label="required"
                      >
                        *
                      </span>
                    )}
                  </FieldLabel>
                  {source && (
                    <SourceMarker source={source} optional={decl.optional} />
                  )}
                </div>
                <input
                  id={fieldId}
                  type={decl.isSecret ? "password" : "text"}
                  value={runtimeEnv[key] ?? ""}
                  onChange={(e) => onEnvVarChange(key, e.target.value)}
                  placeholder={
                    fromPersonal
                      ? "From your personal environment"
                      : mayBePersonal
                        ? "Leave empty to use your personal environment"
                        : decl.optional
                        ? "Optional"
                        : "Required"
                  }
                  disabled={disabled}
                  aria-invalid={!!fieldError}
                  aria-describedby={
                    fieldError
                      ? `${fieldId}-error`
                      : hasHint
                        ? `${fieldId}-desc`
                        : undefined
                  }
                  className={cn(
                    INPUT_CLASSES,
                    fieldError && "stg:border-destructive stg:focus-visible:ring-destructive",
                  )}
                />
                {fromPersonal && !fieldError && (
                  <FieldHint id={`${fieldId}-desc`}>
                    Your personal environment holds this key.{" "}
                    {decl.description
                      ? `${decl.description} `
                      : ""}
                    Enter a value to use a different one for this run.
                  </FieldHint>
                )}
                {unreadable && !fieldError && (
                  <FieldHint id={`${fieldId}-desc`}>
                    Couldn&apos;t read your personal environment — the server
                    will fill it if you saved it.{" "}
                    {decl.description ?? ""}
                  </FieldHint>
                )}
                {!fromPersonal && !unreadable && decl.description && !fieldError && (
                  <FieldHint id={`${fieldId}-desc`}>
                    {decl.description}
                  </FieldHint>
                )}
                {fieldError && (
                  <p
                    id={`${fieldId}-error`}
                    className="stg:text-[0.7rem] stg:text-destructive"
                    role="alert"
                  >
                    {fieldError}
                  </p>
                )}
              </FieldGroup>
            );
          })}
        </div>
      )}

      {/* Trigger message — shown last, only when relevant or toggled open */}
      {showTriggerMessage ? (
        <FieldGroup>
          <FieldLabel htmlFor={`${formId}-trigger`}>
            Trigger Input
          </FieldLabel>
          <textarea
            id={`${formId}-trigger`}
            value={triggerMessage}
            onChange={(e) => onTriggerMessageChange(e.target.value)}
            placeholder="Optional message or JSON payload to trigger the workflow"
            disabled={disabled}
            rows={3}
            className={cn(INPUT_CLASSES, "stg:resize-y")}
          />
          <FieldHint>
            Accessible in the workflow as{" "}
            <code className="stg:text-[0.7rem]">
              {"${ $input }"}
            </code>
          </FieldHint>
        </FieldGroup>
      ) : (
        <button
          type="button"
          onClick={() => onShowTriggerMessageChange(true)}
          disabled={disabled}
          className={cn(
            "stg:self-start stg:text-[0.7rem] stg:text-muted-foreground stg:underline-offset-2 stg:hover:text-foreground stg:hover:underline",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring stg:focus-visible:rounded-sm",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          + Add trigger input
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared form primitives (internal to this file)
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<RunEnvKeySource, string> = {
  typed: "Passed with this run",
  personal: "From your personal environment",
  pending: "Checking your personal environment…",
  unknown: "Unknown",
  missing: "Missing",
};

/**
 * A missing key reads as a problem only when the workflow requires it; a
 * key not yet known never does.
 */
function SourceMarker({
  source,
  optional,
}: {
  readonly source: RunEnvKeySource;
  readonly optional: boolean;
}) {
  const alarming = source === "missing" && !optional;
  return (
    <span
      data-source={source}
      className={cn(
        "stg:ml-2 stg:rounded stg:px-1 stg:py-0.5 stg:text-[0.65rem] stg:font-normal",
        alarming
          ? "stg:bg-destructive-muted stg:text-destructive"
          : "stg:bg-muted stg:text-muted-foreground",
      )}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

function FieldGroup({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <div className="stg:flex stg:flex-col stg:gap-1">{children}</div>;
}

function FieldLabel({
  htmlFor,
  children,
}: {
  readonly htmlFor: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="stg:text-xs stg:font-medium stg:text-foreground">
      {children}
    </label>
  );
}

function FieldHint({
  id,
  children,
}: {
  readonly id?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <p id={id} className="stg:text-[0.7rem] stg:text-muted-foreground">
      {children}
    </p>
  );
}
