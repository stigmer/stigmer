// Types
export type {
  EnvVarEntry,
  KeyValueEntry,
  WizardStepDef,
  WizardState,
  WizardShellProps,
} from "./types";

// Template types and data
export type { ResourceTemplate, TemplateCategory } from "./templates/types";
export { TEMPLATE_CATEGORY_LABELS } from "./templates/types";
export { AGENT_TEMPLATES } from "./templates/agent-templates";
export { MCP_SERVER_TEMPLATES } from "./templates/mcp-server-templates";

// Hooks
export { useWizardState } from "./useWizardState";
export type {
  UseWizardStateOptions,
  UseWizardStateReturn,
} from "./useWizardState";

export { useTemplateFilter } from "./useTemplateFilter";
export type {
  UseTemplateFilterOptions,
  UseTemplateFilterReturn,
} from "./useTemplateFilter";

// Components
export { WizardShell } from "./WizardShell";

export { WizardNav } from "./WizardNav";
export type { WizardNavProps } from "./WizardNav";

export { StepIndicator } from "./StepIndicator";
export type { StepIndicatorProps } from "./StepIndicator";

export { TemplateCard } from "./TemplateCard";
export type { TemplateCardProps } from "./TemplateCard";

export { TemplateGallery } from "./TemplateGallery";
export type { TemplateGalleryProps } from "./TemplateGallery";

export { CreationPicker } from "./CreationPicker";
export type { CreationPickerProps, CreationPath } from "./CreationPicker";
