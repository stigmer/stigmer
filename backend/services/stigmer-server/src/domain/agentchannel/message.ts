/**
 * ChannelMessage controllers — ports pkg/domain/agentchannel/controller/
 * message.go: the runtime messaging surface beside the AgentChannel
 * resource controllers, kept off the resource CRUD surface. Stateless —
 * no store.
 *
 * Both command-shaped RPCs are cloud-only runtime and refuse with
 * FailedPrecondition. Unlike the install refusal (controller.ts), there
 * is deliberately NO load-then-NOT_FOUND here: the cloud send handler
 * fails closed with PERMISSION_DENIED for an unknown channel (DD-002 D4's
 * error table, no existence leak), so probing the store first would
 * CREATE an edition divergence rather than prevent one.
 *
 * listMessagingChannels answers an EMPTY list — a deliberate divergence
 * from its refusing siblings (proactive-messaging DD-006 D3): it is a
 * capability-DISCOVERY read the runner issues on every agent execution to
 * decide whether to attach the send_channel_message tool. The truthful
 * OSS answer is "none", and an expected-error path in that hot loop would
 * be noise; the empty list produces the identical, honest outcome.
 *
 * Input validation is Layer-1: the transport interceptor chain validates
 * every request (matching Go's explicit SharedValidator calls), so the
 * INVALID_ARGUMENT contract holds before every refusal.
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
import { PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE } from "./constants.js";

/** Registers both channel-message services on the router (routes stage). */
export function registerChannelMessageServices(router: ConnectRouter): void {
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
}
