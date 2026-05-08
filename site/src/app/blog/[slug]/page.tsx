import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { InlineTOC } from "fumadocs-ui/components/inline-toc";
import { getMDXComponents } from "@/components/mdx";
import { blog } from "@/lib/source";
import { getGitHubDisplayName } from "@/lib/github";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function BlogPost(props: PageProps) {
  const params = await props.params;
  const page = blog.getPage([params.slug]);
  if (!page) notFound();

  const MDX = page.data.body;
  const authorName = page.data.github
    ? await getGitHubDisplayName(page.data.github)
    : page.data.author;

  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <Link
        href="/blog"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        &larr; All posts
      </Link>

      <header className="mt-8">
        <h1 className="text-3xl font-bold tracking-tight">
          {page.data.title}
        </h1>
        {page.data.description && (
          <p className="mt-2 text-lg text-muted-foreground">
            {page.data.description}
          </p>
        )}
        <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
          {page.data.github && (
            <Image
              src={`https://github.com/${page.data.github}.png?size=80`}
              alt={authorName ?? ""}
              width={40}
              height={40}
              className="rounded-full"
              unoptimized
            />
          )}
          <div className="flex items-center gap-2">
            {page.data.github ? (
              <a
                href={`https://github.com/${page.data.github}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                {authorName}
              </a>
            ) : (
              <span>{authorName}</span>
            )}
            <span>&middot;</span>
            <time dateTime={new Date(page.data.date).toISOString()}>
              {new Date(page.data.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          </div>
        </div>
      </header>

      <div className="prose prose-neutral dark:prose-invert mt-12 max-w-none">
        <InlineTOC items={page.data.toc} />
          <MDX components={getMDXComponents()} />
      </div>
    </article>
  );
}

export function generateStaticParams(): { slug: string }[] {
  return blog.getPages().map((page) => ({
    slug: page.slugs[0],
  }));
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const page = blog.getPage([params.slug]);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
