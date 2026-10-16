import SharedAgentChatPage from "@/domain/sharing/SharedAgentChatPage";

// `output: "export"` requires a non-empty generateStaticParams result (Next 16
// treats [] as “missing”). Real share ids are resolved client-side when the
// host routes unknown paths to this app shell.
export function generateStaticParams() {
  return [{ share: "__placeholder__" }];
}

export default function ChatPage() {
  return <SharedAgentChatPage />;
}
