import { source } from "@/lib/source";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { CopyMarkdownButton, PageFeedback } from "@/components/docs";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = `${page.url}.md`;
  const isIndex = !params.slug || params.slug.length === 0;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      breadcrumb={
        isIndex
          ? { enabled: false }
          : {
              includeRoot: { url: "/docs" },
              includePage: true,
            }
      }
    >
      {/* Hero pages (`hero: true` frontmatter) render their own header via a
          <Hero> in the MDX body; frontmatter title/description still feed
          generateMetadata and the llms outputs. Suppressing the row also drops
          the CopyMarkdownButton there — accepted for landing pages. */}
      {!page.data.hero && (
        <>
          <div className="flex items-center justify-between">
            <DocsTitle>{page.data.title}</DocsTitle>
            <CopyMarkdownButton markdownUrl={markdownUrl} />
          </div>
          <DocsDescription>{page.data.description}</DocsDescription>
        </>
      )}
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
      <PageFeedback pageTitle={page.data.title} pageUrl={page.url} />
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
