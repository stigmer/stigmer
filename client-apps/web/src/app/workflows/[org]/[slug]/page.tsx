import { redirect } from "next/navigation";

export async function generateStaticParams() {
  return [{ org: "__placeholder__", slug: "__placeholder__" }];
}

export default function WorkflowDetailRedirect({
  params,
}: {
  params: { org: string; slug: string };
}) {
  redirect(`/library/workflows/${params.org}/${params.slug}`);
}
