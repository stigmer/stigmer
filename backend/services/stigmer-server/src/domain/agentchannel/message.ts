/**
 * ChannelMessage controllers — ports pkg/domain/agentchannel/controller/
 * message.go: the runtime messaging surface beside the AgentChannel
 * resource controllers, kept off the resource CRUD surface. Stateless on
 * the storing edition — no store.
 *
 * The whole surface is posture-split at REGISTRATION (channel-runtime.ts,
 * C3 ruling Q1): with no ChannelRuntime composed the storing bodies below
 * serve byte-identically to before the seam existed; with one composed,
 * EVERY method delegates — the driver owns runtime state and its own
 * error semantics, including the fail-closed arms this module's storing
 * bodies deliberately do not probe for (see below). Tail-end delegation
 * would force the storing refusals to run first and break exactly those
 * semantics, which is why the split is per-service, not per-line.
 *
 * Storing posture — both command-shaped RPCs are cloud-only runtime and
 * refuse with FailedPrecondition. Unlike the install refusal
 * (controller.ts), there is deliberately NO load-then-NOT_FOUND here: the
 * serving send handler fails closed with PERMISSION_DENIED for an unknown
 * channel (DD-002 D4's error table, no existence leak), so probing the
 * store first would CREATE an edition divergence rather than prevent one.
 *
 * listMessagingChannels answers an EMPTY list — a deliberate divergence
 * from its refusing siblings (proactive-messaging DD-006 D3): it is a
 * capability-DISCOVERY read the runner issues on every agent execution to
 * decide whether to attach the send_channel_message tool. The truthful
 * storing answer is "none", and an expected-error path in that hot loop
 * would be noise; the empty list produces the identical, honest outcome.
 * (The serving edition resolves this read from the caller's agent session
 * and refuses bare direct calls — the two-armed conformance pin.)
 *
 * Input validation is Layer-1: the transport interceptor chain validates
 * every request (matching Go's explicit SharedValidator calls), so the
 * INVALID_ARGUMENT contract holds before every refusal AND before every
 * delegation.
 *
 * Proven by agentchannel.conformance.test.ts (CONFORMANCE_TARGET=local)
 * and __tests__/agentchannel.test.ts.
 */
import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { ChannelMessageCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_command_pb";
import { ChannelMessageQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_query_pb";
import { MessagingChannelsSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import type { MessagingChannels } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";

import { failedPreconditionError } from "../../pipeline/errors.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import type { ChannelRuntime } from "./channel-runtime.js";
import { PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE } from "./constants.js";

/**
 * Registers both channel-message services on the router (routes stage),
 * in the posture the composition declares: storing bodies with no
 * runtime, whole-method delegation with one.
 */
export function registerChannelMessageServices(
  router: ConnectRouter,
  channelRuntime: ChannelRuntime | undefined,
): void {
  if (channelRuntime === undefined) {
    router.service(ChannelMessageCommandController, {
      // Business-initiated channel messaging is cloud-only runtime.
      sendMessage: () => {
        throw failedPreconditionError(PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE);
      },
    });
    router.service(ChannelMessageQueryController, {
      // Provider registry reads are cloud-only runtime; consumers degrade
      // to honest absence (no template section, typed console error state).
      listTemplates: () => {
        throw failedPreconditionError(PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE);
      },
      listMessagingChannels: (): MessagingChannels =>
        create(MessagingChannelsSchema),
    });
    return;
  }

  const { messaging } = channelRuntime;
  router.service(ChannelMessageCommandController, {
    sendMessage: (input, ctx) =>
      messaging.sendMessage(input, callerIdentityOf(ctx)),
  });
  router.service(ChannelMessageQueryController, {
    listTemplates: (input, ctx) =>
      messaging.listTemplates(input, callerIdentityOf(ctx)),
    listMessagingChannels: (input, ctx) =>
      messaging.listMessagingChannels(input, callerIdentityOf(ctx)),
  });
}
