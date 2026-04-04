import type { Metadata } from "next";
import Link from "next/link";
import { blog } from "@/lib/source";
import { SITE_CONFIG } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Blog",
  description: `Engineering blog from the ${SITE_CONFIG.name} team — architecture deep-dives, design decisions, and lessons from building an open-source AI agent platform.`,
  openGraph: {
    title: `Blog | ${SITE_CONFIG.name}`,
    description: `Engineering blog from the ${SITE_CONFIG.name} team.`,
  },
};

export default function BlogIndex() {
  const posts = blog
    .getPages()
    .sort(
      (a, b) =>
        new Date(b.data.date).getTime() - new Date(a.data.date).getTime(),
    );

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight">Blog</h1>
      <p className="mt-2 text-muted-foreground">
        Engineering deep-dives from the {SITE_CONFIG.name} team.
      </p>

      <div className="mt-12 flex flex-col gap-8">
        {posts.map((post) => (
          <Link
            key={post.url}
            href={post.url}
            className="group -mx-4 rounded-lg p-4 transition-colors hover:bg-accent/50"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {new Date(post.data.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
              {" · "}
              {post.data.author}
            </p>
            <h2 className="mt-1 text-xl font-semibold group-hover:text-primary">
              {post.data.title}
            </h2>
            {post.data.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {post.data.description}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
