// Types
export type {
  WorkflowTemplateData,
  WorkflowTemplateCategory,
  WorkflowTemplateMeta,
  WorkflowPattern,
  WorkflowTemplate,
} from "./types";
export { PATTERN_LABELS, WORKFLOW_CATEGORY_LABELS } from "./types";

// Pure derivation
export { deriveTemplateMeta } from "./derive-template-metadata";

// Gallery components (added in Phase 2)
export { WorkflowTemplateCard } from "./WorkflowTemplateCard";
export type { WorkflowTemplateCardProps } from "./WorkflowTemplateCard";
export { WorkflowTemplatePreview } from "./WorkflowTemplatePreview";
export type { WorkflowTemplatePreviewProps } from "./WorkflowTemplatePreview";
export { WorkflowTemplateGallery } from "./WorkflowTemplateGallery";
export type { WorkflowTemplateGalleryProps } from "./WorkflowTemplateGallery";
