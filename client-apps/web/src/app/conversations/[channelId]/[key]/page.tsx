import { ConversationsPage } from "@/domain/conversations/ConversationsPage";

/**
 * Static-export placeholder so `next export` produces an SPA fallback
 * file for deep-linked conversation paths — the page itself reads the
 * real segments from the browser URL through the app navigation
 * provider (the `/sessions/[id]` convention).
 */
export async function generateStaticParams() {
  return [{ channelId: "__placeholder__", key: "__placeholder__" }];
}

export default function ConversationDetailRoute() {
  return <ConversationsPage />;
}
