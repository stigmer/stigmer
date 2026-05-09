// Types
export type {
  AdditionalTab,
  DetailAction,
  ResourceHeaderMeta,
  ConfirmOptions,
  ConfirmState,
  ResourceDetailShellProps,
} from "./types";

// Hooks
export { useCopyResource } from "./useCopyResource";
export type { UseCopyResourceReturn } from "./useCopyResource";

export { useConfirmAction } from "./useConfirmAction";
export type { UseConfirmActionReturn } from "./useConfirmAction";

export { useDeleteResource } from "./useDeleteResource";
export type {
  DeletableResourceKind,
  UseDeleteResourceReturn,
} from "./useDeleteResource";

// Components
export { ResourceActionBar } from "./ResourceActionBar";
export type { ResourceActionBarProps } from "./ResourceActionBar";

export { ResourceDetailShell } from "./ResourceDetailShell";

export { ConfirmDialog } from "./ConfirmDialog";
export type { ConfirmDialogProps } from "./ConfirmDialog";
