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
