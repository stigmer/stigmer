export { useChannelAgentProfile } from "./useChannelAgentProfile.js";
export type {
  UseChannelAgentProfileOptions,
  UseChannelAgentProfileReturn,
} from "./useChannelAgentProfile.js";
export { VisitorChat } from "./VisitorChat.js";
export type { VisitorChatProps } from "./VisitorChat.js";
export {
  draftFromWebChannel,
  chatLinkAudienceFromProto,
  webChannelCreateInput,
  webChannelPatch,
  webConfigOf,
  webLinkTokenOf,
} from "./webChannelDraft.js";
export type {
  WebChannelCreateIdentity,
  WebChannelDraft,
  ChatLinkAudience,
} from "./webChannelDraft.js";
export { useRotateChannelLink } from "./useRotateChannelLink.js";
export type { UseRotateChannelLinkReturn } from "./useRotateChannelLink.js";
export { ChatLinkDialog } from "./ChatLinkDialog.js";
export type { ChatLinkDialogProps } from "./ChatLinkDialog.js";
export { useChatLinkToolReadiness } from "./useChatLinkToolReadiness.js";
export type { ChatLinkToolReadiness } from "./useChatLinkToolReadiness.js";
// Origin validation moved to @stigmer/client (framework-free, shared with the
// CLI); re-exported here so existing @stigmer/react-sdk importers keep working.
export { validateOrigin, MAX_ALLOWED_ORIGINS } from "@stigmer/client";
