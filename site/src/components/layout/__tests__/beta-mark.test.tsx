/** Both of the site's headers say Stigmer is in Beta beside the brand, linked to the page that says what it means. */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { BETA } from "../../../../../brand/beta";
import { Header } from "../Header";
import { DocsHeader } from "../../docs/header/DocsHeader";

vi.mock("fumadocs-core/framework", () => ({ usePathname: () => "/docs" }));
vi.mock("fumadocs-ui/layouts/docs-client", () => ({
  Navbar: ({ children }: { children: ReactNode }) => (
    <header>{children}</header>
  ),
}));
vi.mock("fumadocs-ui/components/layout/search-toggle", () => ({
  LargeSearchToggle: () => null,
  SearchToggle: () => null,
}));
vi.mock("fumadocs-ui/components/layout/sidebar", () => ({
  SidebarTrigger: () => null,
}));
vi.mock("@/components/docs/ask-ai", () => ({ AskAiTrigger: () => null }));

/** The one link labelled with the Beta line, as markup. */
function betaLinks(markup: string): string[] {
  return (
    markup
      .match(/<a\b[^>]*>[^<]*<\/a>/g)
      ?.filter((a) => a.includes(`aria-label="${BETA.line}"`)) ?? []
  );
}

it.each([
  ["the site's header", () => createElement(Header)],
  [
    "the docs' header",
    () =>
      createElement(DocsHeader, { tabs: [{ title: "Docs", url: "/docs" }] }),
  ],
])(
  "%s carries the Beta mark, linked to the Beta page, its name the whole line",
  (_, render) => {
    const links = betaLinks(renderToStaticMarkup(render()));
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`href="${BETA.path}"`);
    expect(links[0]).toContain(`title="${BETA.line}"`);
    expect(links[0]).toMatch(new RegExp(`>${BETA.word}</a>$`));
  },
);
