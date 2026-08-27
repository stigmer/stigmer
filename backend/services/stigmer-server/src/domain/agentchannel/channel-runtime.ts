/**
 * The channel-runtime driver seam — convergence program 20260826.02,
 * DD-004's "contract OSS, delivery runtime cloud" expressed as code;
 * ratified at C3's plan gate (20260827.11, ruling Q1, with the two hooks
 * added by the pre-Stage-1 deep pass recorded in its T01_1_review.md).
 * Lives in src/domain/agentchannel beside the surfaces it fronts (the
 * ModelCatalogProvider / RunnerCredentialProvider placement precedent).
 *
 * OSS serves the AgentChannel CONTRACT: resource CRUD, discovery-shaped
 * reads, and engineered refusals on every arm that would need a delivery
 * runtime (constants.ts — the three byte-pinned "requires Stigmer Cloud"
 * strings). A composition that HAS a delivery runtime registers ONE
 * ChannelRuntime through the drivers registry point
 * (extensions/drivers.ts, single-instance), and the OSS controllers
 * delegate exactly those arms to it. With no driver composed, behavior is
 * byte-identical to the refusal posture — proven by the four conformance
 * rosters on every change to this seam.
 *
 * What stays OSS-owned on every delegated path (the driver never re-does
 * it): Layer-1 proto validation (the transport interceptor chain — the
 * INVALID_ARGUMENT contract holds before any delegation, exactly as it
 * held before any refusal), and the install lane's load-then-X contract
 * (loadChannelForInstall answers cloud's LoadChannel NOT_FOUND verbatim;
 * the loaded channel is handed to the driver so nothing loads twice).
 * What the driver owns: provider I/O, runtime state, and its own error
 * semantics — including cloud's deliberate fail-closed arms (an unknown
 * send target answers PERMISSION_DENIED, DD-002 D4: no existence leak),
 * which is exactly why the messaging/conversation groups delegate WHOLE
 * methods rather than tail-ends.
 *
 * The two hooks exist because the edition split is wider than the refused
 * RPCs (the deep-pass findings):
 *
 *   - enforceWriteConstraints: the write-time rules that only make sense
 *     where the runtime serves. The known one is the pin-REQUIRED rule —
 *     the serving edition refuses an unpinned run_config.model_name at
 *     create/apply/update (InvalidArgument, its copy conformance-pinned
 *     on the cloud target) because its channel execution profile would
 *     bill an unpinned run as Auto. The CONDITION is runtime-profile
 *     knowledge (which harness would serve the run), so the driver owns
 *     both condition and copy — hard-coding "driver present = pin
 *     required" here would bake one composition's harness default into
 *     OSS (the RunnerCredentialProvider lane-vocabulary discipline).
 *     OSS keeps only the edition-neutral pin EXISTENCE rule (steps.ts,
 *     stigmer/stigmer#774).
 *   - teardownOnDelete: the delete-time cascade over runtime state OSS
 *     never materializes (controller.ts delete header: the managed
 *     credentials environment, the OAuth grant, pending-delivery
 *     abandonment). Spliced teardown-BEFORE-row-delete so a failed
 *     teardown leaves the row for an idempotent retry (the cloud#425
 *     ordering family: dependent state dies before the row). A thrown
 *     error fails the delete; fail-soft arms are the driver's own choice,
 *     made per cause, never imposed here.
 *
 * All groups and both hooks are REQUIRED: a composition with a channel
 * runtime implements the whole surface, and a gap is a compile error in
 * the extension package, never a silent OSS refusal a live channel user
 * meets in production.
 */
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type {
  CompleteChannelInstallInput,
  InitiateChannelInstallInput,
  InitiateChannelInstallOutput,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import type {
  ChannelTemplates,
  ListChannelTemplatesInput,
  ListMessagingChannelsInput,
  MessagingChannels,
  SendChannelMessageInput,
  SendChannelMessageOutput,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import type {
  ChannelConversation,
  ChannelConversationList,
  ConversationControlInput,
  ConversationMediaDownloadUrl,
  ConversationTimeline,
  EscalateConversationInput,
  GetChannelConversationInput,
  GetConversationMediaDownloadUrlInput,
  GetConversationTimelineInput,
  ListChannelConversationsInput,
  ReplyToConversationInput,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";

import type { CallerIdentity } from "../../extensions/identity.js";

/**
 * The provider install lane (Go install.go's cloud arm). OSS has already
 * validated the input and loaded the channel — the NOT_FOUND contract is
 * spent before the driver runs; `channel` is that loaded resource.
 */
export interface ChannelRuntimeInstalls {
  /** The OAuth-initiate arm — the driver issues the state token and the redirect. */
  initiateInstall(
    channel: AgentChannel,
    input: InitiateChannelInstallInput,
    caller: CallerIdentity,
  ): Promise<InitiateChannelInstallOutput>;
  /** The OAuth-complete arm — the driver exchanges the code and stamps install status. */
  completeInstall(
    channel: AgentChannel,
    input: CompleteChannelInstallInput,
    caller: CallerIdentity,
  ): Promise<AgentChannel>;
}

/**
 * The messaging runtime surface (message.ts's serving arm). The caller
 * identity is load-bearing: the serving edition resolves
 * listMessagingChannels from the CALLER's agent session and refuses bare
 * direct calls (a verified, two-arm-pinned edition divergence), and
 * sendMessage's authorization is reach-based over the caller's session —
 * both driver-owned decisions this seam only transports.
 */
export interface ChannelRuntimeMessaging {
  sendMessage(
    input: SendChannelMessageInput,
    caller: CallerIdentity,
  ): Promise<SendChannelMessageOutput>;
  listTemplates(
    input: ListChannelTemplatesInput,
    caller: CallerIdentity,
  ): Promise<ChannelTemplates>;
  listMessagingChannels(
    input: ListMessagingChannelsInput,
    caller: CallerIdentity,
  ): Promise<MessagingChannels>;
}

/**
 * The conversation runtime surface (conversation.ts's serving arm) —
 * queries AND commands: on the serving edition even the discovery reads
 * are real store-backed lookups (the truthful-emptiness contract both
 * editions share is an outcome there, not a stub), and getMediaDownloadUrl
 * must keep the byte-pinned uniform miss across every cause (constants.ts
 * NO_DOWNLOADABLE_MEDIA_MESSAGE — a prober cannot learn which items
 * exist). escalate carries no channel id by design: the driver derives
 * the conversation from the caller's session labels.
 */
export interface ChannelRuntimeConversations {
  listConversations(
    input: ListChannelConversationsInput,
    caller: CallerIdentity,
  ): Promise<ChannelConversationList>;
  getConversation(
    input: GetChannelConversationInput,
    caller: CallerIdentity,
  ): Promise<ChannelConversation>;
  getTimeline(
    input: GetConversationTimelineInput,
    caller: CallerIdentity,
  ): Promise<ConversationTimeline>;
  getMediaDownloadUrl(
    input: GetConversationMediaDownloadUrlInput,
    caller: CallerIdentity,
  ): Promise<ConversationMediaDownloadUrl>;
  reply(
    input: ReplyToConversationInput,
    caller: CallerIdentity,
  ): Promise<SendChannelMessageOutput>;
  takeOver(
    input: ConversationControlInput,
    caller: CallerIdentity,
  ): Promise<ChannelConversation>;
  handBack(
    input: ConversationControlInput,
    caller: CallerIdentity,
  ): Promise<ChannelConversation>;
  clearAttention(
    input: ConversationControlInput,
    caller: CallerIdentity,
  ): Promise<ChannelConversation>;
  escalate(
    input: EscalateConversationInput,
    caller: CallerIdentity,
  ): Promise<ChannelConversation>;
}

/**
 * One composition's channel delivery runtime, grouped by the surfaces it
 * takes over (the groups mirror the OSS file seams — controller.ts's
 * install lane, message.ts, conversation.ts — which are themselves the
 * retired Go server's file seams).
 */
export interface ChannelRuntime {
  readonly installs: ChannelRuntimeInstalls;
  readonly messaging: ChannelRuntimeMessaging;
  readonly conversations: ChannelRuntimeConversations;
  /**
   * Write-time constraints only a serving runtime can state, invoked by
   * ResolveChannelDefaults (create/apply) and ValidateChannelUpdate
   * (update) AFTER the edition-neutral rules pass, with the fully
   * resolved channel. Refuses by throwing a ConnectError with the
   * correct code and the runtime's conformance-pinned copy; returning
   * resolves the write.
   */
  enforceWriteConstraints(channel: AgentChannel): Promise<void>;
  /**
   * The delete-time cascade over runtime state (credentials environment,
   * OAuth grant, pending deliveries), invoked after LoadExistingForDelete
   * and BEFORE the row delete — a thrown error fails the delete and
   * leaves the row for an idempotent retry.
   */
  teardownOnDelete(
    channel: AgentChannel,
    caller: CallerIdentity,
  ): Promise<void>;
}
