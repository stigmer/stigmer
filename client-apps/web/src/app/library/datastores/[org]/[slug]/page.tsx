import { DatastoreDetailPage } from "@/domain/library/datastores/DatastoreDetailPage";

export async function generateStaticParams() {
  return [{ org: "__placeholder__", slug: "__placeholder__" }];
}

export default function Page() {
  return <DatastoreDetailPage />;
}
