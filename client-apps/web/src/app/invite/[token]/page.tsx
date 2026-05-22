import InvitePageClient from "./InvitePageClient";

// `output: "export"` requires a non-empty generateStaticParams result (Next 16 treats [] as
// “missing”). Real tokens are still resolved client-side when the host routes unknown
// paths to this app shell.
export function generateStaticParams() {
  return [{ token: "__placeholder__" }];
}

export default function InvitePage() {
  return <InvitePageClient />;
}
