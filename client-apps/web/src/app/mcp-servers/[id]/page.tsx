import McpServerDetailPage from "./McpServerDetailPage";

export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default function Page() {
  return <McpServerDetailPage />;
}
