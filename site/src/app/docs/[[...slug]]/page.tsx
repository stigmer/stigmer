import { source } from "@/lib/source";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { PageRoot, PageArticle } from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <PageRoot toc={page.data.toc}>
      <PageArticle>
        <MDX components={{ ...defaultMdxComponents }} />
      </PageArticle>
    </PageRoot>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}
