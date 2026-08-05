// The send_channel_message tool — the ONE tool of the channels roster
// (proactive-messaging DD-002 D7, arguments amended by DD-006 D5 to
// mirror the ChannelOutboundPayload oneof: `text` | `template`, exactly
// one).
//
// Agent audience only, by construction: this roster is what the
// runner-synthesized channel attachment connects to, and a session-bound
// caller's org derives from its token (an explicit org is rejected —
// the records T05 R3 rule), so no `org` argument exists to invite
// rejected calls. A direct-audience variant on the full roster is
// deliberately NOT registered: operators send through the console, CLI,
// and SDK, which carry the org+channel addressing the direct reach path
// requires.
//
// The typed outcome is the tool's answer, verbatim proto JSON:
// `accepted` (delivered to the provider), `queued` (transient failure —
// the platform retries in the background; do NOT resend), `refused`
// (terminal; `detail` says why — adapt, never retry the same send).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import { sendChannelMessage, type TemplateArg } from "./calls.js";
import { channelResult } from "./errors.js";
import { errorResult } from "../toolresult.js";

const templateShape = z.object({
  name: z.string().describe("Approved template name on the channel's provider registry."),
  language: z
    .string()
    .optional()
    .describe(
      "Template language code (e.g. en, en_US). Omit when the template exists in exactly one language.",
    ),
  parameters: z
    .record(z.string())
    .optional()
    .describe(
      'Placeholder values. Positional templates key by position ("1", "2", …); ' +
        'named templates key by parameter name ("member_name").',
    ),
  header_image_link: z
    .string()
    .optional()
    .describe(
      "Public HTTPS URL for the image header. Required exactly when the template " +
        "declares an image header.",
    ),
});

/** Register the channel messaging tool; returns the tool names. */
export function registerChannelTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "send_channel_message",
    {
      description:
        "Send a business-initiated message to a recipient on this agent's messaging channel " +
        "(e.g. WhatsApp). Exactly one of text | template. Outside a 24-hour customer-service " +
        "window the provider only accepts a pre-approved template, so prefer a template from " +
        "<available_channel_templates>. The result carries a typed outcome: accepted (sent), " +
        "queued (the platform retries in the background — do not resend), or refused " +
        "(terminal; detail says why — adapt, never retry the same send).",
      inputSchema: {
        recipient: z
          .string()
          .describe(
            "Recipient's key on the channel's provider, passed to the provider verbatim. " +
              'WhatsApp: the wa_id — digits only INCLUDING the country code, no "+" or ' +
              'separators (e.g. "919912850490"). Never reformat a wa_id another tool returned.',
          ),
        text: z
          .string()
          .optional()
          .describe(
            "Plain text body. Only deliverable inside an open 24-hour customer-service window.",
          ),
        template: templateShape
          .optional()
          .describe("Pre-approved template send — required outside a 24-hour window."),
        channel: z
          .string()
          .optional()
          .describe(
            "Channel slug. Only needed when this agent serves more than one " +
              "proactive-messaging channel (a refusal will list them).",
          ),
      },
    },
    (args, extra) => {
      // Exactly-one, checked here with corrective copy the model can act
      // on immediately; the server's required-oneof validation is the
      // backstop (DD-006 D5).
      const hasText = args.text !== undefined && args.text !== "";
      const hasTemplate = args.template !== undefined;
      if (hasText === hasTemplate) {
        return Promise.resolve(errorResult(
          hasText
            ? "supply exactly one of text | template, not both"
            : "supply exactly one of text | template — text for an open 24-hour window, " +
              "template otherwise",
        ));
      }
      return channelResult(`message to "${args.recipient}"`, () =>
        sendChannelMessage(target.serverAddress, resolveToken(extra, target.apiKey), {
          recipient: args.recipient,
          text: args.text,
          template: args.template as TemplateArg | undefined,
          channel: args.channel,
        }),
      );
    },
  );

  return ["send_channel_message"];
}
