// Types
export type {
  EnvVarEntry,
  KeyValueEntry,
  WizardStepDef,
  WizardState,
  WizardShellProps,
} from "./types.js";

// Template types and data
export type { ResourceTemplate, TemplateCategory } from "./templates/types.js";
export { TEMPLATE_CATEGORY_LABELS } from "./templates/types.js";
export { AGENT_TEMPLATES } from "./templates/agent-templates.js";
export { MCP_SERVER_TEMPLATES } from "./templates/mcp-server-templates.js";
export { WORKFLOW_TEMPLATES } from "./templates/workflow-templates.js";
export type { WorkflowTemplateData } from "./templates/workflow-templates.js";

// Hooks
export { useWizardState } from "./useWizardState.js";
export type {
  UseWizardStateOptions,
  UseWizardStateReturn,
} from "./useWizardState.js";

export { useTemplateFilter } from "./useTemplateFilter.js";
export type {
  UseTemplateFilterOptions,
  UseTemplateFilterReturn,
} from "./useTemplateFilter.js";

// Components
export { WizardShell } from "./WizardShell.js";

export { WizardNav } from "./WizardNav.js";
export type { WizardNavProps } from "./WizardNav.js";

export { StepIndicator } from "./StepIndicator.js";
export type { StepIndicatorProps } from "./StepIndicator.js";

export { TemplateCard } from "./TemplateCard.js";
export type { TemplateCardProps } from "./TemplateCard.js";

export { TemplateGallery } from "./TemplateGallery.js";
export type { TemplateGalleryProps } from "./TemplateGallery.js";

export { CreationPicker } from "./CreationPicker.js";
export type { CreationPickerProps, CreationPath } from "./CreationPicker.js";
