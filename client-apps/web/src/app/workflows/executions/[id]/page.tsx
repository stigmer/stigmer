import { redirect } from "next/navigation";

export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default function ExecutionDetailRedirect({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/executions/${params.id}`);
}
