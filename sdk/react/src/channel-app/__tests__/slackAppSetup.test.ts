import { describe, it, expect } from "vitest";
import {
  buildSlackChannelAppManifest,
  slackChannelAppRedirectUrl,
  slackChannelAppWebhookUrl,
  SLACK_CHANNEL_APP_BOT_EVENTS,
  SLACK_CHANNEL_APP_BOT_SCOPES,
} from "../slackAppSetup";

describe("slackChannelAppWebhookUrl", () => {
  it("builds the per-app events route — the path is the signing-secret discriminator", () => {
    expect(slackChannelAppWebhookUrl("https://api.stigmer.ai", "chapp_01abc")).toBe(
      "https://api.stigmer.ai/webhook/slack/chapp_01abc",
    );
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(slackChannelAppWebhookUrl("https://api.stigmer.ai/", "chapp_01abc")).toBe(
      "https://api.stigmer.ai/webhook/slack/chapp_01abc",
    );
  });
});

describe("slackChannelAppRedirectUrl", () => {
  it("derives the console callback route from an explicit origin", () => {
    expect(slackChannelAppRedirectUrl("https://app.stigmer.ai")).toBe(
      "https://app.stigmer.ai/oauth/slack/callback",
    );
  });
});

describe("buildSlackChannelAppManifest", () => {
  it("renders the customer identity with the platform app's exact scope and event sets", () => {
    const manifest = buildSlackChannelAppManifest({
      name: "Acme Support Bot",
      redirectUrl: "https://app.stigmer.ai/oauth/slack/callback",
      webhookUrl: "https://api.stigmer.ai/webhook/slack/chapp_01abc",
    });

    expect(manifest).toContain("name: Acme Support Bot");
    expect(manifest).toContain("display_name: Acme Support Bot");
    expect(manifest).toContain(
      '- "https://app.stigmer.ai/oauth/slack/callback"',
    );
    expect(manifest).toContain(
      'request_url: "https://api.stigmer.ai/webhook/slack/chapp_01abc"',
    );
    for (const scope of SLACK_CHANNEL_APP_BOT_SCOPES) {
      expect(manifest).toContain(`- ${scope}`);
    }
    for (const event of SLACK_CHANNEL_APP_BOT_EVENTS) {
      expect(manifest).toContain(`- ${event}`);
    }
    // Deliberate platform mirrors that must never drift silently.
    expect(manifest).toContain("org_deploy_enabled: false");
    expect(manifest).toContain("socket_mode_enabled: false");
  });

  it("omits event subscriptions before the webhook URL exists (phase-one manifest)", () => {
    const manifest = buildSlackChannelAppManifest({
      name: "Acme Support Bot",
      redirectUrl: "https://app.stigmer.ai/oauth/slack/callback",
    });

    expect(manifest).not.toContain("event_subscriptions");
    expect(manifest).not.toContain("request_url");
    // The rest of the manifest is intact.
    expect(manifest).toContain("oauth_config:");
    expect(manifest).toContain("org_deploy_enabled: false");
  });

  it("keeps the scope set at exactly four — scope minimalism is load-bearing", () => {
    expect(SLACK_CHANNEL_APP_BOT_SCOPES).toHaveLength(4);
  });
});
