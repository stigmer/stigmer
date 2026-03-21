import { source } from "@/lib/source";
import defaultMdxComponents from "fumadocs-ui/mdx";
import {
  Card,
  Cards,
  Callout,
  Tab,
  Tabs,
  Step,
  Steps,
  Accordion,
  Accordions,
  Mermaid,
  LanguageIcons,
} from "@docs-kit";
import { PageRoot, PageArticle } from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";

const mdxComponents = {
  ...defaultMdxComponents,
  Card,
  Cards,
  Callout,
  Tab,
  Tabs,
  Step,
  Steps,
  Accordion,
  Accordions,
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
