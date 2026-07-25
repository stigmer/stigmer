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
import { PageActions } from "@/components/docs";
import { buildBreadcrumbItems } from "@/lib/breadcrumb";
import { markdownExportUrl } from "@/lib/llms-pages";
import { DocsBreadcrumb } from "../breadcrumb";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = markdownExportUrl(page.url);
  // Tab-aware trail; empty on tab landing pages (/docs, /docs/sdk, /docs/cli),
  // which hides the breadcrumb there — see buildBreadcrumbItems.
  const crumbs = buildBreadcrumbItems(source.pageTree, page.url);
  // Rendered in the right rail on desktop and inside the "On this page"
  // popover on smaller viewports. Passing the footer also keeps the rail
  // alive on pages without headings (Fumadocs enables the TOC container when
  // a footer is present).
  const actions = (
    <PageActions
      markdownUrl={markdownUrl}
      pageTitle={page.data.title}
      pageUrl={page.url}
    />
  );

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      breadcrumb={{
        enabled: crumbs.length > 0,
        component: <DocsBreadcrumb items={crumbs} />,
      }}
      tableOfContent={{ footer: actions }}
      tableOfContentPopover={{ footer: actions }}
    >
      {/* Hero pages (`hero: true` frontmatter) render their own header via a
          <Hero> in the MDX body; frontmatter title/description still feed
          generateMetadata and the llms outputs. */}
      {!page.data.hero && (
        <>
          {/* Bold + tight tracking matches the marketing Hero.tsx headline and
              the welcome page's <Hero> h1 — one display voice across the site. */}
          <DocsTitle className="font-bold tracking-tight">
            {page.data.title}
          </DocsTitle>
          {/* text-base/mb-6 over the default text-lg/mb-8 — DD-02 density:
              the oversized description was a big part of the "zoomed" feel
              above the fold. */}
          <DocsDescription className="mb-6 text-base">
            {page.data.description}
          </DocsDescription>
        </>
      )}
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
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
