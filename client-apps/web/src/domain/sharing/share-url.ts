// The console's public link for a share (a web channel): the configured app
// origin plus the channel's permanent id (`/chat/<channel id>`), the one
// identity a hosted chat link carries. The agent detail page hands it to the
// share list and dialog.
import { buildChatUrl } from "@stigmer/sdk";

import { getAppBaseUrl } from "@/config/env";

/**
 * The public hosted chat link for a web channel, `<app origin>/chat/<channel id>`,
 * on the console's configured public origin. The link names only the
 * channel, by its permanent id, so no rename of its organization moves it.
 */
export function shareUrlFor(channelId: string): string {
  return buildChatUrl(getAppBaseUrl(), channelId);
}
