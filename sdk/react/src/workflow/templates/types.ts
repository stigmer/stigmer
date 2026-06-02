import type { ResourceTemplate, TemplateCategory } from "../../resource-creation/templates/types";

/**
 * Workflow-specific template categories for the gallery filter tabs.
 *
 * These extend the shared `TemplateCategory` type with workflow-specific
 * use-case domains. The gallery renders them as filterable tabs alongside
 * the generic categories.
 */
export type WorkflowTemplateCategory = TemplateCategory;

/**
 * Human-readable labels for workflow template categories.
 */
export const WORKFLOW_CATEGORY_LABELS: Record<WorkflowTemplateCategory, string> =
  {
    "customer-support": "Customer Support",
    "code-review": "Code Review",
    "data-analysis": "Data Analysis",
    devops: "DevOps",
    content: "Content",
    integration: "Integration",
    general: "General",
  };

/**
 * The data payload carried by a workflow template.
 *
 * Unlike agent templates (which carry form fields for a wizard),
 * workflow templates carry the full YAML string. Selecting a template
 * opens the editor with this YAML as `initialYaml`.
 */
export interface WorkflowTemplateData {
  /** Full workflow YAML including apiVersion/kind/metadata/spec envelope. */
  readonly yaml: string;
}

/**
 * A structural workflow pattern detected in a template's YAML.
 *
 * Pattern badges help users visually identify what a template
 * demonstrates without reading the full YAML.
 */
export type WorkflowPattern =
  | "parallel"
  | "branching"
  | "hitl"
  | "loop"
  | "error-handling"
  | "batch"
  | "ai-pipeline"
  | "http-integration";

/** Human-readable labels for pattern badges. */
export const PATTERN_LABELS: Record<WorkflowPattern, string> = {
  parallel: "Parallel",
  branching: "Branching",
  hitl: "Human-in-the-Loop",
  loop: "Loop",
  "error-handling": "Error Handling",
  batch: "Batch Processing",
  "ai-pipeline": "AI Pipeline",
  "http-integration": "HTTP Integration",
};

/**
 * Metadata derived from a workflow template's YAML content.
 *
 * Computed once at render time by `deriveTemplateMeta()` and displayed
 * on template cards and preview dialogs.
 */
export interface WorkflowTemplateMeta {
  /** Number of top-level tasks (excludes nested tasks inside fork/try_catch/for_each). */
  readonly taskCount: number;
  /** Unique task kind strings used in the template. */
  readonly taskKinds: readonly string[];
  /** Structural patterns detected in the template. */
  readonly patterns: readonly WorkflowPattern[];
  /** Number of environment variable declarations. */
  readonly envVarCount: number;
  /** Whether the template declares a budget. */
  readonly hasBudget: boolean;
}

/** Workflow template = generic ResourceTemplate with workflow-specific data. */
export type WorkflowTemplate = ResourceTemplate<WorkflowTemplateData>;
