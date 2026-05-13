"use client";

import { useId } from "react";
import { cn } from "@stigmer/theme";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { RunWorkflowFieldErrors } from "./useRunWorkflowFlow";

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

  /** Field-level validation errors keyed by field name. */
  readonly errors: RunWorkflowFieldErrors;

  /** When `true`, all fields are disabled (during submission). */
  readonly disabled?: boolean;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

const INPUT_CLASSES = cn(
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground",
  "placeholder:text-muted-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
);

/**
 * Form fields for running a workflow execution.
 *
 * Renders a trigger message textarea, auto-generated environment
 * variable fields from the workflow's `spec.env` declarations, and
 * an instance selector (hidden when 0-1 instances exist).
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
  errors,
  disabled,
  className,
}: WorkflowRunFormProps) {
  const formId = useId();
  const envEntries = Object.entries(envDeclarations);
  const showInstanceSelector = instances.length > 1;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Trigger message */}
      <FieldGroup>
        <FieldLabel htmlFor={`${formId}-trigger`}>Input Message</FieldLabel>
        <textarea
          id={`${formId}-trigger`}
          value={triggerMessage}
          onChange={(e) => onTriggerMessageChange(e.target.value)}
          placeholder="Optional message or JSON payload to trigger the workflow"
          disabled={disabled}
          rows={3}
          className={cn(INPUT_CLASSES, "resize-y")}
        />
        <FieldHint>
          Accessible in the workflow as{" "}
          <code className="text-[0.7rem]">
            {"{{workflow.input.trigger_message}}"}
          </code>
        </FieldHint>
      </FieldGroup>

      {/* Instance selector (only when multiple instances exist) */}
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
            <option value="">Default instance (auto)</option>
            {instances.map((inst) => (
              <option key={inst.metadata?.id} value={inst.metadata?.id ?? ""}>
                {inst.metadata?.name || inst.metadata?.slug || inst.metadata?.id}
              </option>
            ))}
          </select>
        </FieldGroup>
      )}

      {/* Environment variables */}
      {envEntries.length > 0 && (
        <div className="flex flex-col gap-3">
          <h4 className="text-xs font-medium text-muted-foreground">
            Environment Variables
          </h4>
          {envEntries.map(([key, decl]) => {
            const fieldId = `${formId}-env-${key}`;
            const fieldError = errors[key];
            return (
              <FieldGroup key={key}>
                <FieldLabel htmlFor={fieldId}>
                  <code className="text-xs">{key}</code>
                  {!decl.optional && (
                    <span
                      className="ml-1 text-destructive"
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
                    decl.optional ? "Optional" : "Required"
                  }
                  disabled={disabled}
                  aria-invalid={!!fieldError}
                  aria-describedby={
                    fieldError
                      ? `${fieldId}-error`
                      : decl.description
                        ? `${fieldId}-desc`
                        : undefined
                  }
                  className={cn(
                    INPUT_CLASSES,
                    fieldError && "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {decl.description && !fieldError && (
                  <FieldHint id={`${fieldId}-desc`}>
                    {decl.description}
                  </FieldHint>
                )}
                {fieldError && (
                  <p
                    id={`${fieldId}-error`}
                    className="text-[0.7rem] text-destructive"
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
  return <div className="flex flex-col gap-1">{children}</div>;
}

function FieldLabel({
  htmlFor,
  children,
}: {
  readonly htmlFor: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
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
    <p id={id} className="text-[0.7rem] text-muted-foreground">
      {children}
    </p>
  );
}
