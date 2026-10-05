/**
 * Pins the channel lanes' binding check (message.ts, conversation.ts): the
 * runtime decides who may message, read templates or list conversations,
 * but a credential bound to one organization that names another is refused
 * with the binding's sentence before the runtime is asked; its own
 * organization reaches the runtime. The handlers run on an in-process
 * router whose verifier stamps a bound caller; the runtime is a recording
 * fake.
 */
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ChannelConversationQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_query_pb";
import { ChannelMessageCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_command_pb";
import { ChannelMessageQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_query_pb";

import { BOUND_ELSEWHERE_DENY_REASON } from "../../../authorization/credential-binding.js";
import { createLogger } from "../../../boot/logger.js";
import type { IdentityVerifier } from "../../../extensions/identity.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import type { ChannelRuntime } from "../channel-runtime.js";
import { registerChannelConversationServices } from "../conversation.js";
import { registerChannelMessageServices } from "../message.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const boundVerifier: IdentityVerifier = {
  name: "bound-test",
  verify: async (token) => ({
    identityId: "ida_alice",
    callerClass: "user",
    issuer: "",
    rawToken: token,
    boundOrg: "org_a",
  }),
};

function harness() {
  const reached: string[] = [];
  const runtime = {
    messaging: {
      sendMessage: async () => (reached.push("sendMessage"), {}),
      listTemplates: async () => (reached.push("listTemplates"), {}),
      listMessagingChannels: async () => ({}),
    },
    conversations: {
      listConversations: async () => (reached.push("listConversations"), {}),
    },
  } as unknown as ChannelRuntime;
  const transport = createRouterTransport(
    (router) => {
      registerChannelMessageServices(router, runtime);
      registerChannelConversationServices(router, runtime);
    },
    {
      router: {
        interceptors: [
          createVerifierChainInterceptor([boundVerifier], [], silentLogger),
        ],
      },
    },
  );
  const headers = { authorization: "Bearer bound-token" };
  const messageCommand = createClient(
    ChannelMessageCommandController,
    transport,
  );
  const messageQuery = createClient(ChannelMessageQueryController, transport);
  const conversationQuery = createClient(
    ChannelConversationQueryController,
    transport,
  );
  return {
    reached,
    calls: (org: string) => [
      () =>
        messageCommand.sendMessage(
          { org, channel: "chan-1", recipient: "15551234567" },
          { headers },
        ),
      () => messageQuery.listTemplates({ org, channel: "chan-1" }, { headers }),
      () => conversationQuery.listConversations({ org }, { headers }),
    ],
  };
}

describe("channel lanes under a credential bound to one organization", () => {
  it("refuse another organization before the runtime is asked", async () => {
    const h = harness();
    for (const call of h.calls("org_b")) {
      const error = await call().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.PermissionDenied);
      expect((error as ConnectError).rawMessage).toBe(
        BOUND_ELSEWHERE_DENY_REASON,
      );
    }
    expect(h.reached).toEqual([]);
  });

  it("hand its own organization to the runtime", async () => {
    const h = harness();
    for (const call of h.calls("org_a")) await call();
    expect(h.reached).toEqual([
      "sendMessage",
      "listTemplates",
      "listConversations",
    ]);
  });
});
