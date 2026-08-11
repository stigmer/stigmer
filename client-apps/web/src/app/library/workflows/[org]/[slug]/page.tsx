import { WorkflowDetailPage } from "@/domain/workflow/WorkflowDetailPage";

export async function generateStaticParams() {
  return [{ org: "__placeholder__", slug: "__placeholder__" }];
}

export default function Page() {
  return <WorkflowDetailPage />;
}
