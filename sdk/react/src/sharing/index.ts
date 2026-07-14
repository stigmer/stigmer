export { useSharedAgentProfile } from "./useSharedAgentProfile.js";
export type {
  UseSharedAgentProfileOptions,
  UseSharedAgentProfileReturn,
} from "./useSharedAgentProfile.js";
export { SharedAgentChat } from "./SharedAgentChat.js";
export type { SharedAgentChatProps } from "./SharedAgentChat.js";
export { useAgentShares } from "./useAgentShares.js";
export type { UseAgentSharesReturn } from "./useAgentShares.js";
export { useCanCreateAgentShare } from "./useCanCreateAgentShare.js";
export type { UseCanCreateAgentShareReturn } from "./useCanCreateAgentShare.js";
export {
  draftFromShare,
  sharingAudienceFromProto,
  useSaveAgentShare,
} from "./useSaveAgentShare.js";
export type {
  AgentShareCreateIdentity,
  AgentShareDraft,
  SharingAudience,
  UseSaveAgentShareReturn,
} from "./useSaveAgentShare.js";
export { useDeleteAgentShare } from "./useDeleteAgentShare.js";
export type { UseDeleteAgentShareReturn } from "./useDeleteAgentShare.js";
export { useRotateShareLink } from "./useRotateShareLink.js";
export type { UseRotateShareLinkReturn } from "./useRotateShareLink.js";
export { ShareAgentDialog } from "./ShareAgentDialog.js";
export type { ShareAgentDialogProps } from "./ShareAgentDialog.js";
export { AgentShareList } from "./AgentShareList.js";
export type { AgentShareListProps } from "./AgentShareList.js";
export { useShareToolReadiness } from "./useShareToolReadiness.js";
export type { ShareToolReadiness } from "./useShareToolReadiness.js";
// Origin validation moved to @stigmer/sdk (framework-free, shared with the
// CLI); re-exported here so existing @stigmer/react importers keep working.
export { validateOrigin, MAX_ALLOWED_ORIGINS } from "@stigmer/sdk";
