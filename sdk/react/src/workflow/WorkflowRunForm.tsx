"use client";

import { useId } from "react";
import { cn } from "@stigmer/theme";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { RunWorkflowFieldErrors } from "./useRunWorkflowFlow.js";

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

  /** Available workflow instances for the selector. */
  readonly instances: readonly WorkflowInstance[];
  /** Currently selected instance ID, or `null` for server-resolved default. */
  readonly selectedInstanceId: string | null;
  /** Called when the selected instance changes. */
  readonly onInstanceChange: (id: string | null) => void;
  /**
   * The platform-managed default instance ID (from workflow.status.defaultInstanceId).
   * When provided, the picker shows whenever user-created instances exist (>= 1),
   * and labels the default option clearly.
   */
  readonly defaultInstanceId?: string;

  /**
   * Set of env var keys already provided by the selected instance's
   * bound environments. Fields for these keys are shown as optional
   * overrides rather than required inputs.
   */
  readonly instanceEnvKeys?: Set<string>;

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
 * Form fields for running a workflow execution.
 *
 * Renders auto-generated environment variable fields from the workflow's
 * `spec.env` declarations, an instance selector (hidden when 0-1 instances
 * exist), and a conditionally-visible trigger message textarea.
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
 *   instances={instances}
 *   selectedInstanceId={flow.selectedInstanceId}
 *   onInstanceChange={flow.setSelectedInstanceId}
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
  instances,
  selectedInstanceId,
  onInstanceChange,
  defaultInstanceId,
  instanceEnvKeys,
  showTriggerMessage,
  onShowTriggerMessageChange,
  errors,
  disabled,
  className,
}: WorkflowRunFormProps) {
  const formId = useId();
  const envEntries = Object.entries(envDeclarations);
  const userInstances = defaultInstanceId
    ? instances.filter((i) => i.metadata?.id !== defaultInstanceId)
    : instances;
  const showInstanceSelector = defaultInstanceId
    ? userInstances.length >= 1
    : instances.length > 1;

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
      {/* Instance selector — shown first so env var state reacts to selection */}
      {showInstanceSelector && (
        <FieldGroup>
          <FieldLabel htmlFor={`${formId}-instance`}>Instance</FieldLabel>
          <select
            id={`${formId}-instance`}
            value={selectedInstanceId ?? ""}
            onChange={(e) =>
              onInstanceChange(e.target.value || null)
            }
            disabled={disabled}
            className={INPUT_CLASSES}
          >
            <option value="">Default (no specific configuration)</option>
            {userInstances.map((inst) => {
              const envCount = inst.spec?.environmentRefs?.length ?? 0;
              const envSuffix = envCount > 0 ? ` (${envCount} env${envCount > 1 ? "s" : ""})` : "";
              return (
                <option key={inst.metadata?.id} value={inst.metadata?.id ?? ""}>
                  {inst.metadata?.name || inst.metadata?.slug || inst.metadata?.id}{envSuffix}
                </option>
              );
            })}
          </select>
        </FieldGroup>
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
            const satisfiedByInstance = instanceEnvKeys?.has(key) ?? false;
            const isRequired = !decl.optional && !satisfiedByInstance;
            return (
              <FieldGroup key={key}>
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
                <input
                  id={fieldId}
                  type={decl.isSecret ? "password" : "text"}
                  value={runtimeEnv[key] ?? ""}
                  onChange={(e) => onEnvVarChange(key, e.target.value)}
                  placeholder={
                    satisfiedByInstance
                      ? "Provided by instance"
                      : decl.optional
                        ? "Optional"
                        : "Required"
                  }
                  disabled={disabled}
                  aria-invalid={!!fieldError}
                  aria-describedby={
                    fieldError
                      ? `${fieldId}-error`
                      : decl.description || satisfiedByInstance
                        ? `${fieldId}-desc`
                        : undefined
                  }
                  className={cn(
                    INPUT_CLASSES,
                    fieldError && "stg:border-destructive stg:focus-visible:ring-destructive",
                  )}
                />
                {satisfiedByInstance && !fieldError && (
                  <FieldHint id={`${fieldId}-desc`}>
                    Provided by instance environment.{" "}
                    {decl.description
                      ? `${decl.description} `
                      : ""}
                    Enter a value to override.
                  </FieldHint>
                )}
                {!satisfiedByInstance && decl.description && !fieldError && (
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
