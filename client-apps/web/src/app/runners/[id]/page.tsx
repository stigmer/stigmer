import { RunnerDetailPage } from "@/domain/runner/RunnerDetailPage";

export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <RunnerDetailPage id={id} />
    </div>
  );
}
