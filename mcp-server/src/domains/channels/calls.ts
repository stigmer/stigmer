// Channel-messaging RPC invocations for the send_channel_message tool —
// a 1:1 projection of ChannelMessageCommandController.sendMessage
// (proactive-messaging DD-006 D5: the tool layer adds no semantics;
// reach, recipient policy, caps, and the template pre-check all live in
// the cloud handler, and the OSS edition refuses with the documented
// FAILED_PRECONDITION).
//
// The records-domain calls.ts shape: build request, call, marshal. The
// typed outcome (accepted/queued/refused + detail) rides back VERBATIM
// as proto JSON — a refusal is an ANSWER the model adapts to (DD-002
// D4), never a tool error.

import { create } from "@bufbuild/protobuf";
import {
  ChannelMessageCommandController,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_command_pb";
import {
  ChannelOutboundPayloadSchema,
  SendChannelMessageInputSchema,
  SendChannelMessageOutputSchema,
  TemplatePayloadSchema,
  TextPayloadSchema,
  type ChannelOutboundPayload,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";

/** The template arm as the model supplies it (mirrors TemplatePayload). */
export interface TemplateArg {
  name: string;
  language?: string;
  parameters?: Record<string, string>;
  header_image_link?: string;
}

export interface SendArgs {
  recipient: string;
  text?: string;
  template?: TemplateArg;
  channel?: string;
}

export async function sendChannelMessage(
  serverAddress: string,
  token: string,
  args: SendArgs,
): Promise<string> {
  const request = create(SendChannelMessageInputSchema, {
    channel: args.channel ?? "",
    // org is deliberately never sent: a session-bound caller's org is
    // server-derived, and an explicit value is rejected (the records
    // T05 R3 rule applied to messaging).
    recipient: args.recipient,
    payload: buildPayload(args),
  });
  return withClient(ChannelMessageCommandController, serverAddress, token, async (client, opts) =>
    toProtoJson(SendChannelMessageOutputSchema, await client.sendMessage(request, opts)),
  );
}

/**
 * The payload oneof from the tool's mutually exclusive arguments. The
 * tool handler enforces exactly-one before calling; the server's
 * required-oneof validation is the backstop.
 */
function buildPayload(args: SendArgs): ChannelOutboundPayload {
  if (args.template !== undefined) {
    return create(ChannelOutboundPayloadSchema, {
      kind: {
        case: "template",
        value: create(TemplatePayloadSchema, {
          name: args.template.name,
          language: args.template.language ?? "",
          parameters: args.template.parameters ?? {},
          headerImageLink: args.template.header_image_link ?? "",
        }),
      },
    });
  }
  return create(ChannelOutboundPayloadSchema, {
    kind: {
      case: "text",
      value: create(TextPayloadSchema, { body: args.text ?? "" }),
    },
  });
}
