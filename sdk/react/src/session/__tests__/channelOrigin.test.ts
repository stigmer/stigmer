// Which sessions read as a Slack or WhatsApp conversation. Every session a
// channel serves carries the channel id, a guest's chat-link session
// included; only a Slack or WhatsApp conversation carries the conversation
// key, so only that label may switch a session to the read-only observer
// view and withhold auto-approval.

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  CHANNEL_SESSION_LABELS,
  channelSessionExternalUserKey,
  isChannelOriginSession,
} from "../channelOrigin";

function sessionLabelled(labels: Record<string, string>): Session {
  return create(SessionSchema, { metadata: { id: "ses_1", org: "acme", labels } });
}

describe("isChannelOriginSession", () => {
  it("answers true for a Slack or WhatsApp conversation, which carries the conversation key", () => {
    const session = sessionLabelled({
      [CHANNEL_SESSION_LABELS.channelId]: "chn_1",
      [CHANNEL_SESSION_LABELS.externalUserKey]: "U0AB12CD3",
      [CHANNEL_SESSION_LABELS.conversationKey]: "C0AB12CD3:1712345678.000100",
    });

    expect(isChannelOriginSession(session)).toBe(true);
  });

  it("answers false for a chat-link session, which carries a channel id and no conversation key", () => {
    const session = sessionLabelled({ [CHANNEL_SESSION_LABELS.channelId]: "chn_1" });

    expect(isChannelOriginSession(session)).toBe(false);
  });

  it("answers false for a session a person started in the console, and for no session", () => {
    expect(isChannelOriginSession(sessionLabelled({}))).toBe(false);
    expect(isChannelOriginSession(null)).toBe(false);
    expect(isChannelOriginSession(undefined)).toBe(false);
  });
});

describe("channelSessionExternalUserKey", () => {
  it("reads the external platform user of a channel conversation", () => {
    const session = sessionLabelled({ [CHANNEL_SESSION_LABELS.externalUserKey]: "U0AB12CD3" });

    expect(channelSessionExternalUserKey(session)).toBe("U0AB12CD3");
    expect(channelSessionExternalUserKey(sessionLabelled({}))).toBeUndefined();
  });
});
