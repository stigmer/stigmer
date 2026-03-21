import { McpServerDetailPage } from "./McpServerDetailPage";

export async function generateStaticParams() {
  return [{ slug: "__placeholder__" }];
}

export default function Page() {
  return <McpServerDetailPage />;
}
