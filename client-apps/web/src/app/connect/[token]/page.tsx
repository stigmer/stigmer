import ConnectPageClient from "./ConnectPageClient";

// `output: "export"` requires a non-empty generateStaticParams result (Next 16
// treats [] as “missing”). Real link secrets are resolved client-side when the
// host routes unknown paths to this app shell.
export function generateStaticParams() {
  return [{ token: "__placeholder__" }];
}

export default function ConnectPage() {
  return <ConnectPageClient />;
}
