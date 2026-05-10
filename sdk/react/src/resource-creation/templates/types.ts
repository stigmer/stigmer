/**
 * Template categories for grouping resource templates in the gallery.
 *
 * Each category maps to a common use-case domain. The gallery renders
 * these as filterable tabs. Platform builders can use the same
 * categories or extend with custom values if they define their own
 * template arrays.
 */
export type TemplateCategory =
  | "customer-support"
  | "code-review"
  | "data-analysis"
  | "devops"
  | "content"
  | "integration"
  | "general";

/**
 * Human-readable labels for template categories.
 *
 * Used by the gallery UI for tab labels and screen readers.
 * Exported so platform builders can reuse or extend them.
 */
export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  "customer-support": "Customer Support",
  "code-review": "Code Review",
  "data-analysis": "Data Analysis",
  devops: "DevOps",
  content: "Content",
  integration: "Integration",
  general: "General",
};

/**
 * A pre-built resource configuration that seeds a creation wizard.
 *
 * Generic over `TData` — the wizard's accumulated form state type.
 * For agents, `TData` is `AgentWizardData`; for MCP servers,
 * `TData` is `McpServerWizardData`.
 *
 * `data` is `Partial<TData>`: only the fields the template wants to
 * pre-fill. The wizard merges this with its default empty state via
 * `{ ...createInitialWizardData(), ...template.data }`.
 *
 * @typeParam TData - The wizard's accumulated form data shape.
 */
export interface ResourceTemplate<TData> {
  /** Stable template identifier (unique within a resource kind). */
  readonly id: string;
  /** Human-readable template name displayed in the gallery card. */
  readonly name: string;
  /** Short description of what this template sets up. */
  readonly description: string;
  /** Category for gallery filtering. */
  readonly category: TemplateCategory;
  /** Searchable tags for the gallery's text search. */
  readonly tags?: readonly string[];
  /**
   * Partial wizard data to merge with defaults when the user
   * selects this template. Only fields that the template wants
   * to pre-fill are included.
   */
  readonly data: Partial<TData>;
}
