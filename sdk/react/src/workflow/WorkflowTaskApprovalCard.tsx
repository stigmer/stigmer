"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/theme";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS } from "../internal/markdown-components";

/** Outcome descriptor for UI rendering. */
export interface TaskOutcome {
  readonly name: string;
  readonly label: string;
}

/** Props for {@link WorkflowTaskApprovalCard}. */
export interface WorkflowTaskApprovalCardProps {
  /** Name of the human_input task awaiting a decision. */
  readonly taskName: string;
  /**
   * Resolved prompt text from the workflow's human_input task config.
   * Rendered as markdown above the decision form to give the reviewer
   * context about what they are approving.
   */
  readonly prompt?: string;
  /**
   * Configured outcomes from the workflow definition.
   * Each entry renders as a button with the label as text.
   * When empty, defaults to "Approve" / "Reject".
   */
  readonly outcomes: readonly TaskOutcome[];
  /**
   * JSON Schema describing the reviewer's input form.
   * When provided, renders form fields from the schema's `properties`.
   * Text properties render as textareas; others as text inputs.
   */
  readonly formSchema?: Record<string, unknown>;
  /**
   * Called when the reviewer submits a decision.
   * The consumer (typically {@link WorkflowExecutionViewer}) wires this
   * to `useWorkflowExecutionActions().submitTaskApproval`.
   */
  readonly onSubmit: (
    taskName: string,
    outcome: string,
    formData?: Record<string, unknown>,
    comment?: string,
  ) => Promise<unknown>;
  /** True while the submission RPC is in flight. */
  readonly isSubmitting: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

const DEFAULT_OUTCOMES: readonly TaskOutcome[] = [
  { name: "approve", label: "Approve" },
  { name: "reject", label: "Reject" },
];

/**
 * Interactive approval card for workflow-level human_input tasks.
 *
 * Renders dynamic outcome buttons (from workflow configuration),
 * optional form fields (from JSON Schema), and a comment textarea.
 * Designed for inline rendering in the execution timeline when a
 * human_input task is in `waiting_approval` state.
 *
 * Distinct from `WorkflowExecutionApprovalCard` (which handles agent
 * tool approvals with `toolCallId` + `ApprovalAction`). This component
 * uses `taskName` + `outcome` string + optional `formData`.
 *
 * Follows SDK component standards:
 * - All colors via `--stgm-*` tokens (DD-005)
 * - Keyboard navigable with ARIA labels (a11y)
 * - `React.memo` for referential stability (DD-010)
 * - Zero framework dependencies (DD-004)
 *
 * @example
 * ```tsx
 * <WorkflowTaskApprovalCard
 *   taskName="daily_approval"
 *   prompt="Review today's notification plan.\n\n**DAU**: 7,297 (down 15%)"
 *   outcomes={[{ name: "approve", label: "Approve Plan" }, { name: "reject", label: "Reject" }]}
 *   formSchema={{ type: "object", properties: { feedback: { type: "string" } } }}
 *   onSubmit={actions.submitTaskApproval}
 *   isSubmitting={actions.isSubmitting}
 * />
 * ```
 */
export const WorkflowTaskApprovalCard = memo(function WorkflowTaskApprovalCard({
  taskName,
  prompt,
  outcomes: outcomesProp,
  formSchema,
  onSubmit,
  isSubmitting,
  className,
}: WorkflowTaskApprovalCardProps) {
  const outcomes = outcomesProp.length > 0 ? outcomesProp : DEFAULT_OUTCOMES;
  const [activeOutcome, setActiveOutcome] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [formData, setFormData] = useState<Record<string, string>>({});

  const formFields = useMemo(() => extractFormFields(formSchema), [formSchema]);

  useEffect(() => {
    if (!isSubmitting) {
      setActiveOutcome(null);
    }
  }, [isSubmitting]);

  const handleFieldChange = useCallback((fieldName: string, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  }, []);

  const handleSubmit = useCallback(
    (outcomeName: string) => {
      setActiveOutcome(outcomeName);
      const data = formFields.length > 0
        ? Object.fromEntries(
            Object.entries(formData).filter(([, v]) => v.trim() !== ""),
          )
        : undefined;
      onSubmit(
        taskName,
        outcomeName,
        data && Object.keys(data).length > 0 ? data : undefined,
        comment.trim() || undefined,
      );
    },
    [taskName, formData, comment, formFields.length, onSubmit],
  );

  return (
    <div
      role="form"
      aria-label={`Approval decision for ${taskName}`}
      aria-busy={isSubmitting}
      className={cn(
        "mt-2 rounded-lg border border-warning/30 bg-warning/5 p-3",
        className,
      )}
    >
      {prompt && (
        <div className="mb-3 max-h-80 overflow-y-auto rounded border border-border bg-background p-3">
          <div className="stgm-prose">
            <Markdown components={MARKDOWN_COMPONENTS} remarkPlugins={REMARK_PLUGINS}>
              {prompt}
            </Markdown>
          </div>
        </div>
      )}

      {formFields.length > 0 && (
        <div className="mb-3 space-y-2">
          {formFields.map((field) => (
            <div key={field.name}>
              <label
                htmlFor={`${taskName}-${field.name}`}
                className="mb-1 block text-xs font-medium text-foreground"
              >
                {field.label}
              </label>
              <textarea
                id={`${taskName}-${field.name}`}
                value={formData[field.name] ?? ""}
                onChange={(e) => handleFieldChange(field.name, e.target.value)}
                placeholder={field.description}
                disabled={isSubmitting}
                rows={2}
                className={cn(
                  "w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus:outline-none focus:ring-1 focus:ring-ring",
                  "disabled:opacity-50",
                  "resize-y",
                )}
              />
            </div>
          ))}
        </div>
      )}

      <div className="mb-2">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Comment (optional)"
          disabled={isSubmitting}
          rows={1}
          className={cn(
            "w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground",
            "placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:opacity-50",
            "resize-y",
          )}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {outcomes.map((outcome, index) => (
          <OutcomeButton
            key={outcome.name}
            label={outcome.label || capitalize(outcome.name)}
            outcomeName={outcome.name}
            variant={resolveVariant(outcome.name, index, outcomes.length)}
            isActive={activeOutcome === outcome.name}
            isSubmitting={isSubmitting}
            onClick={handleSubmit}
          />
        ))}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "destructive" | "secondary";

function OutcomeButton({
  label,
  outcomeName,
  variant,
  isActive,
  isSubmitting,
  onClick,
}: {
  readonly label: string;
  readonly outcomeName: string;
  readonly variant: ButtonVariant;
  readonly isActive: boolean;
  readonly isSubmitting: boolean;
  readonly onClick: (name: string) => void;
}) {
  const variantClasses: Record<ButtonVariant, string> = {
    primary: cn(
      "bg-success text-success-foreground hover:bg-success/90",
      "disabled:bg-success/50 disabled:text-success-foreground/70",
    ),
    destructive: cn(
      "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
      "disabled:bg-destructive-subtle0 disabled:text-destructive-foreground/70",
    ),
    secondary: cn(
      "border border-border bg-background text-foreground hover:bg-muted",
      "disabled:bg-muted-faint disabled:text-muted-foreground-faint",
    ),
  };

  return (
    <button
      type="button"
      disabled={isSubmitting}
      onClick={() => onClick(outcomeName)}
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed",
        variantClasses[variant],
      )}
    >
      {isActive && isSubmitting ? <SpinnerIcon /> : null}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FormField {
  readonly name: string;
  readonly label: string;
  readonly description: string;
}

function extractFormFields(schema?: Record<string, unknown>): FormField[] {
  if (!schema || typeof schema !== "object") return [];
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return [];

  return Object.entries(properties as Record<string, Record<string, unknown>>).map(
    ([name, prop]) => ({
      name,
      label: capitalize(name.replace(/_/g, " ")),
      description: (typeof prop?.description === "string" ? prop.description : "") as string,
    }),
  );
}

function resolveVariant(
  outcomeName: string,
  index: number,
  total: number,
): ButtonVariant {
  if (index === 0) return "primary";

  const lower = outcomeName.toLowerCase();
  if (lower === "reject" || lower === "deny" || lower.includes("reject")) {
    return "destructive";
  }

  if (index === total - 1 && total === 2) {
    return "destructive";
  }

  return "secondary";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}
