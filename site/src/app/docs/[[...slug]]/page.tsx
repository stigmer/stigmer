import { source } from "@/lib/source";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Mermaid } from "@/components/mdx/mermaid";
import { LanguageIcons } from "@/components/mdx/language-icons";
import { PageRoot, PageArticle } from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";

const mdxComponents = {
  ...defaultMdxComponents,
  Card,
  Cards,
  Mermaid,
  LanguageIcons,
};

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <PageRoot toc={{ toc: page.data.toc }}>
      <PageArticle>
        <MDX components={mdxComponents} />
      </PageArticle>
    </PageRoot>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}
