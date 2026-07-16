"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS } from "../internal/markdown-components.js";
import { DecisionButton, type DecisionVariant } from "../internal/DecisionButton.js";
import { InCardDecisionError } from "../internal/InCardDecisionError.js";
import { formatJson } from "../execution/tool-rendering-primitives.js";
import { StructuredDataViewer } from "./execution-inspector/StructuredDataViewer.js";

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
   * Resolved review payload — the material under review (issue #234).
   * Rendered as structured data between the prompt and the form. This is
   * the portable fallback presentation; gates whose `ui_hint` matches a
   * registered review renderer never reach this card (see
   * {@link WorkflowTaskReviewGate}).
   */
  readonly payload?: JsonValue | null;
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
  /** True while this gate's submission RPC is in flight. */
  readonly isSubmitting: boolean;
  /**
   * This gate's last failed decision, or `null`. Surfaced in-card beside the
   * outcome buttons (via the shared {@link InCardDecisionError}) — supply
   * {@link useWorkflowExecutionActions}'s `taskApprovalErrorsByTaskName` for
   * this `taskName`.
   */
  readonly error?: Error | null;
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
 * Distinct from `WorkflowApprovalList` (which handles agent tool
 * approvals with `toolCallId` + `ApprovalAction` via the shared
 * `ApprovalCard`). This component uses `taskName` + `outcome` string +
 * optional `formData`.
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
  payload = null,
  onSubmit,
  isSubmitting,
  error,
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
      // Neutral card + 2px warning left accent — the quiet Cursor-grade chrome
      // shared with ApprovalCard. (Replaces the old amber `bg-warning/5` fill.)
      className={cn(
        "mt-2 rounded-lg border border-border-prominent border-l-2 border-l-warning p-3",
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

      {payload !== null && (
        <div
          aria-label={`Review material for ${taskName}`}
          className="mb-3 max-h-96 overflow-y-auto rounded border border-border bg-background p-3"
        >
          {isPlainObject(payload) ? (
            <StructuredDataViewer data={payload} />
          ) : (
            <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
              <code>{formatJson(payload)}</code>
            </pre>
          )}
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
          <DecisionButton
            key={outcome.name}
            label={outcome.label || capitalize(outcome.name)}
            variant={resolveVariant(outcome.name, index, outcomes.length)}
            onClick={() => handleSubmit(outcome.name)}
            isActive={activeOutcome === outcome.name}
            isSubmitting={isSubmitting}
          />
        ))}
      </div>

      {/* A failed decision surfaces HERE, beside this gate's outcome buttons —
          not in the viewer's lifecycle banner. A workflow can hold many gates at
          once, so a failure must name the one it belongs to; the optimistic
          spinner has already reverted, and this explains the snap-back. Shared
          with the agent ApprovalCard / FileReviewCard via InCardDecisionError. */}
      {error && (
        <div className="mt-2">
          <InCardDecisionError
            error={error}
            leadIn="submit decision"
            cursorTarget="wf-task-approval-error"
          />
        </div>
      )}
    </div>
  );
});

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
): DecisionVariant {
  // The first outcome is the recommended action (the quiet neutral chip).
  if (index === 0) return "primary";

  const lower = outcomeName.toLowerCase();
  if (lower === "reject" || lower === "deny" || lower.includes("reject")) {
    return "danger";
  }

  // In a simple two-outcome form, the trailing outcome is the negative one.
  if (index === total - 1 && total === 2) {
    return "danger";
  }

  return "ghost";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Object payloads get the structured viewer; arrays and scalars get JSON. */
function isPlainObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
