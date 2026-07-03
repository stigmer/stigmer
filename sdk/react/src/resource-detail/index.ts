// Types
export type {
  AdditionalTab,
  DetailAction,
  ResourceHeaderMeta,
  ConfirmOptions,
  ConfirmState,
  ResourceDetailShellProps,
} from "./types.js";

// Hooks
export { useCopyResource } from "./useCopyResource.js";
export type { UseCopyResourceReturn } from "./useCopyResource.js";

export { useConfirmAction } from "./useConfirmAction.js";
export type { UseConfirmActionReturn } from "./useConfirmAction.js";

export { useDeleteResource } from "./useDeleteResource.js";
export type {
  DeletableResourceKind,
  UseDeleteResourceReturn,
} from "./useDeleteResource.js";

// Components
export { ResourceActionBar } from "./ResourceActionBar.js";
export type { ResourceActionBarProps } from "./ResourceActionBar.js";

export { ResourceDetailShell } from "./ResourceDetailShell.js";

export { ConfirmDialog } from "./ConfirmDialog.js";
export type { ConfirmDialogProps } from "./ConfirmDialog.js";

export { Section } from "./Section.js";
export type { SectionProps } from "./Section.js";
