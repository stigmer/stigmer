/**
 * Pure helpers for the "bring your own Slack app" setup surface
 * (T04 item 2).
 *
 * A customer-owned Slack app needs three Stigmer-side values wired into
 * its configuration on api.slack.com: the OAuth redirect URL (shared by
 * every app — the console's callback route), the app's own events
 * webhook URL (per-app by design: the path is how the receiver knows
 * which signing secret verifies the request), and the fixed scope/event
 * sets. These helpers derive those values and render a ready-to-paste
 * Slack app manifest so creating the app is one paste instead of a dozen
 * dashboard steps.
 *
 * Setup is inherently two-phase — Slack mints the credentials, Stigmer
 * mints the webhook URL, and each needs the other's output:
 *
 *  1. Create the Slack app from {@link buildSlackChannelAppManifest}
 *     WITHOUT a webhook URL (events come later), then paste its
 *     credentials into `CreateChannelAppForm`.
 *  2. The saved ChannelApp has an id, so `ChannelAppDetailPanel` can show
 *     the webhook URL — paste it into the app's Event Subscriptions (or
 *     re-apply the completed manifest).
 */

/**
 * The bot scopes every Stigmer channel app requests — the platform app's
 * exact set (scope minimalism is deliberate: it is the first thing a
 * workspace admin reviews on the consent screen).
 */
export const SLACK_CHANNEL_APP_BOT_SCOPES = [
  "app_mentions:read",
  "assistant:write",
  "chat:write",
  "im:history",
] as const;

/**
 * The bot events every Stigmer channel app subscribes to — the platform
 * app's exact set (mentions, DMs, assistant surface, and the uninstall/
 * revocation lifecycle events).
 */
export const SLACK_CHANNEL_APP_BOT_EVENTS = [
  "app_home_opened",
  "app_mention",
  "app_uninstalled",
  "assistant_thread_context_changed",
  "assistant_thread_started",
  "message.im",
  "tokens_revoked",
] as const;

/**
 * The events webhook URL for one ChannelApp: the per-app route the
 * receiver resolves the app's signing secret by.
 *
 * @param apiBaseUrl the Stigmer API origin (`stigmer.baseUrl`)
 * @param channelAppId the ChannelApp resource id (`chapp_...`)
 */
export function slackChannelAppWebhookUrl(
  apiBaseUrl: string,
  channelAppId: string,
): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/webhook/slack/${channelAppId}`;
}

/**
 * The OAuth redirect URL a customer registers on their Slack app — the
 * console's install-callback route, shared by every app (the platform
 * completes the code exchange server-side with the app's own
 * credentials).
 *
 * @param consoleOrigin the console origin (defaults to the current
 *                      window's origin; pass explicitly in non-browser
 *                      hosts)
 */
export function slackChannelAppRedirectUrl(consoleOrigin?: string): string {
  const origin =
    consoleOrigin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin.replace(/\/+$/, "")}/oauth/slack/callback`;
}

/** Inputs for {@link buildSlackChannelAppManifest}. */
export interface SlackChannelAppManifestInput {
  /** Bot display name — what the workspace @mentions. */
  readonly name: string;
  /** One-line app description shown on the consent screen. */
  readonly description?: string;
  /** The console's OAuth redirect URL ({@link slackChannelAppRedirectUrl}). */
  readonly redirectUrl: string;
  /**
   * The app's events webhook URL ({@link slackChannelAppWebhookUrl}).
   * Omit before the ChannelApp exists — the manifest then skips event
   * subscriptions, which are completed from the detail panel after
   * creation.
   */
  readonly webhookUrl?: string;
}

/**
 * Render the ready-to-paste Slack app manifest for a customer channel
 * app — the platform app's manifest with the customer's identity.
 *
 * Deliberate mirrors of the platform manifest (do not "fix" them):
 * four bot scopes only, `org_deploy_enabled: false` (Enterprise Grid
 * org-wide installs are unsupported), no interactivity, no socket mode.
 */
export function buildSlackChannelAppManifest(
  input: SlackChannelAppManifestInput,
): string {
  const description =
    input.description ??
    "Chat with your organization's Stigmer agent without leaving Slack.";

  const eventSubscriptions = input.webhookUrl
    ? `  event_subscriptions:
    request_url: "${input.webhookUrl}"
    bot_events:
${SLACK_CHANNEL_APP_BOT_EVENTS.map((e) => `      - ${e}`).join("\n")}
`
    : "";

  return `display_information:
  name: ${input.name}
  description: ${description}

features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: ${input.name}
    always_online: true
  assistant_view:
    assistant_description: ${description}
    suggested_prompts: []

oauth_config:
  redirect_urls:
    - "${input.redirectUrl}"
  scopes:
    bot:
${SLACK_CHANNEL_APP_BOT_SCOPES.map((s) => `      - ${s}`).join("\n")}

settings:
${eventSubscriptions}  interactivity:
    is_enabled: false
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
`;
}
