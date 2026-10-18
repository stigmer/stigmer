import { RoutineDetailPage } from "@/domain/library/routines/RoutineDetailPage";

export async function generateStaticParams() {
  return [{ org: "__placeholder__", slug: "__placeholder__" }];
}

export default function Page() {
  return <RoutineDetailPage />;
}
