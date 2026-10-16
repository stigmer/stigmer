import ChatLinkPage from "@/domain/chat-link/ChatLinkPage";

// `output: "export"` requires a non-empty generateStaticParams result (Next 16
// treats [] as “missing”). Real channel ids are resolved client-side when the
// host routes unknown paths to this app shell.
export function generateStaticParams() {
  return [{ channel: "__placeholder__" }];
}

export default function ChatPage() {
  return <ChatLinkPage />;
}
