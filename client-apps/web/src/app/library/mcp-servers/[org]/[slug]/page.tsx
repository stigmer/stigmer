import { McpServerDetailPage } from "@/domain/library/mcp-servers/McpServerDetailPage";

export async function generateStaticParams() {
  return [{ org: "__placeholder__", slug: "__placeholder__" }];
}

export default function Page() {
  return <McpServerDetailPage />;
}
