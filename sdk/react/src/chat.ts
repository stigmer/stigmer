// @stigmer/react-sdk/chat: the light entry. Everything a page needs to put
// Stigmer's chat in a product, and nothing else, so its import stays under
// its own size budget (`test/bundle-budgets.json`, `react-sdk/chat`). The
// same modules as the root entry, so contexts stay single across entries.
// The client and its token cache import from `@stigmer/client`, which the
// page already imports to make the client.

export { AgentChat } from "./agent-chat/AgentChat.js";
export type { AgentChatProps, AgentChatVariant } from "./agent-chat/AgentChat.js";
export { StigmerProvider, type StigmerProviderProps } from "./provider.js";
export { useStigmer } from "@stigmer/react-core";
export type { SessionAudience } from "./session/audience.js";
export type { SessionRunConfig } from "./session/run-config.js";
export type { OnCustomToolUse } from "./session/useCustomToolUseCallback.js";
// Making the chat your own: a host's tool cards (`toolCards` on the
// provider), its message actions (`messageActions` on the chat) and the
// thread's slots (`threadSlots`), with the props each slot receives.
export type {
  CustomToolAnswer,
  ToolCallInfo,
  ToolCallState,
  ToolCardProps,
  ToolCards,
  MessageAction,
  MessageInfo,
  MessageThreadSlots,
  MessageEntryProps,
  ApprovalCardProps,
  TodoCardProps,
  TodoRowProps,
  PlanFileCardProps,
  PlanCompletionCardProps,
  PlanStreamingCardProps,
  SetupProgressProps,
  RecalledMemoriesCardProps,
  RunErrorNoticeProps,
  LivenessStatusLineProps,
} from "./run/index.js";
// Each slot's built-in: a slot draws the cases it changes and hands every
// other one back to ours, so a page on this entry alone can. These are thin
// components that draw the root's real ones (run/lazy-built-ins.tsx): inside
// the chat from the thread itself, on its first frame, so importing them
// adds nothing to the page's first download and the part arrives with the
// conversation, as it does when nothing is customized.
export {
  MessageEntry,
  ApprovalCard,
  TodoCard,
  TodoRow,
  PlanFileCard,
  PlanCompletionCard,
  PlanStreamingCard,
  SetupProgress,
  RecalledMemoriesCard,
  RunErrorNotice,
  LivenessStatusLine,
} from "./run/lazy-built-ins.js";
