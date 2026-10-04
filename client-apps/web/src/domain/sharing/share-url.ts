// The console's public link for a share: the configured app origin plus the
// share's permanent id (`/chat/<share id>`), the one identity a hosted chat
// link carries. The agent detail page hands it to the share list and dialog.
import { buildChatUrl } from "@stigmer/sdk";

import { getAppBaseUrl } from "@/config/env";

/**
 * The public hosted chat link for a share, `<app origin>/chat/<share id>`,
 * on the console's configured public origin. The link names only the
 * share, by its permanent id, so no rename of its organization moves it.
 */
export function shareUrlFor(shareId: string): string {
  return buildChatUrl(getAppBaseUrl(), shareId);
}
