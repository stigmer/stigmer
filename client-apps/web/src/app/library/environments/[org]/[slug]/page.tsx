import { EnvironmentDetailPage } from "@/domain/library/environments/EnvironmentDetailPage";

export async function generateStaticParams() {
  return [{ org: "__placeholder__", slug: "__placeholder__" }];
}

export default function Page() {
  return <EnvironmentDetailPage />;
}
