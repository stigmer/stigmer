// Memory — agent-proposed, user-confirmed facts (stigmer/stigmer#293
// Phase 2). The record is the trust surface over the recall seam: every
// fact is individually reviewable, editable, and deletable, and nothing
// is recalled until its subject confirms it.

export { MemoryListPanel, type MemoryListPanelProps } from "./MemoryListPanel.js";
export {
  groupMemoriesByLifecycle,
  formatMemoryProvenance,
  type MemoryGroups,
} from "./memoryGroups.js";
export { useMemories, type UseMemoriesReturn } from "./useMemories.js";
export { useConfirmMemory, type UseConfirmMemoryReturn } from "./useConfirmMemory.js";
export { useRejectMemory, type UseRejectMemoryReturn } from "./useRejectMemory.js";
export { useDeleteMemory, type UseDeleteMemoryReturn } from "./useDeleteMemory.js";
export {
  useUpdateMemoryContent,
  type UseUpdateMemoryContentReturn,
} from "./useUpdateMemoryContent.js";
