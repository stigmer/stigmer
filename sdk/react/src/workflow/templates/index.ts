// Types
export type {
  WorkflowTemplateData,
  WorkflowTemplateCategory,
  WorkflowTemplateMeta,
  WorkflowPattern,
  WorkflowTemplate,
} from "./types.js";
export { PATTERN_LABELS, WORKFLOW_CATEGORY_LABELS } from "./types.js";

// Pure derivation
export { deriveTemplateMeta } from "./derive-template-metadata.js";

// Gallery components (added in Phase 2)
export { WorkflowTemplateCard } from "./WorkflowTemplateCard.js";
export type { WorkflowTemplateCardProps } from "./WorkflowTemplateCard.js";
export { WorkflowTemplatePreview } from "./WorkflowTemplatePreview.js";
export type { WorkflowTemplatePreviewProps } from "./WorkflowTemplatePreview.js";
export { WorkflowTemplateGallery } from "./WorkflowTemplateGallery.js";
export type { WorkflowTemplateGalleryProps } from "./WorkflowTemplateGallery.js";
