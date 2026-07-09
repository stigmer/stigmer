import SharedAgentChatPage from "@/domain/sharing/SharedAgentChatPage";

// `output: "export"` requires a non-empty generateStaticParams result (Next 16
// treats [] as “missing”). Real org/slug pairs are resolved client-side when
// the host routes unknown paths to this app shell.
export function generateStaticParams() {
  return [{ org: "__placeholder__", slug: "__placeholder__" }];
}

export default function ChatPage() {
  return <SharedAgentChatPage />;
}
