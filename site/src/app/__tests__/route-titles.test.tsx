/**
 * The route pages that read content name themselves in the display face:
 * the blog's index, a blog post, a docs page and the download page set their
 * title (`h1`) in Instrument Sans (`font-display`, brand/type.ts), as
 * components/pages/__tests__/display-type.test.tsx holds for the pages that
 * render without content.
 *
 * The blog and the docs read their posts and pages from the content source at
 * build time, so the source is mocked with one post and one page; the docs
 * page's Fumadocs frame is replaced by plain elements that pass on the class
 * names the page gives them, which is all this file reads.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/lib/source", () => {
  const page = {
    url: "/docs/a-page",
    slugs: ["a-page"],
    data: {
      title: "A page",
      description: "What it says.",
      date: new Date("2026-10-22"),
      body: () => null,
      toc: [],
      full: false,
    },
  };
  return {
    blog: {
      getPages: () => [{ ...page, url: "/blog/a-post", slugs: ["a-post"], data: { ...page.data, title: "A post" } }],
      getPage: ([slug]: string[]) =>
        slug === "a-post" ? { ...page, url: "/blog/a-post", data: { ...page.data, title: "A post" } } : undefined,
    },
    source: {
      getPage: (slugs?: string[]) => (slugs?.[0] === "a-page" ? page : undefined),
      pageTree: { name: "Docs", children: [] },
    },
  };
});

vi.mock("@/lib/github", () => ({ getGitHubDisplayName: async () => "A writer" }));

// The download page asks GitHub for the newest desktop release once mounted;
// a test never reaches the network, so it answers that there is none.
vi.mock("@/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/constants")>()),
  fetchDesktopRelease: async () => null,
}));

vi.mock("fumadocs-ui/page", () => {
  const Pass = ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  );
  return {
    DocsPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
    DocsBody: Pass,
    DocsDescription: Pass,
    DocsTitle: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <h1 className={className}>{children}</h1>
    ),
  };
});

afterEach(cleanup);

const titleOf = (container: HTMLElement) => {
  const titles = [...container.querySelectorAll("h1")];
  expect(titles.length, "one page title").toBe(1);
  return titles[0];
};

describe("the route pages' titles", () => {
  it("sets the blog's index title in the display face", async () => {
    const { default: BlogIndex } = await import("../blog/page");
    const { container } = render(await BlogIndex());

    expect(titleOf(container).textContent).toBe("Blog");
    expect(titleOf(container).classList.contains("font-display")).toBe(true);
  });

  it("sets a blog post's title in the display face", async () => {
    const { default: BlogPost } = await import("../blog/[slug]/page");
    const { container } = render(await BlogPost({ params: Promise.resolve({ slug: "a-post" }) }));

    expect(titleOf(container).textContent).toBe("A post");
    expect(titleOf(container).classList.contains("font-display")).toBe(true);
  });

  it("sets a docs page's title in the display face", async () => {
    const { default: DocsRoute } = await import("../docs/[[...slug]]/page");
    const { container } = render(await DocsRoute({ params: Promise.resolve({ slug: ["a-page"] }) }));

    expect(titleOf(container).textContent).toBe("A page");
    expect(titleOf(container).classList.contains("font-display")).toBe(true);
  });

  it("sets the download page's title in the display face", async () => {
    const { DownloadPage } = await import("@/components/pages/DownloadPage");
    const { container } = render(<DownloadPage />);

    expect(titleOf(container).classList.contains("font-display")).toBe(true);
  });
});
