import { AgentDetailPage } from "./AgentDetailPage";

export async function generateStaticParams() {
  return [{ slug: "__placeholder__" }];
}

export default function Page() {
  return <AgentDetailPage />;
}
