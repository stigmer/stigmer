/** Pin the docs home link and its shaded artwork without mounting optional search or chat controls. */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { DocsHeader } from "../DocsHeader";

vi.mock("fumadocs-core/framework", () => ({ usePathname: () => "/docs" }));
vi.mock("fumadocs-ui/layouts/docs-client", () => ({
  Navbar: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock("fumadocs-ui/components/layout/search-toggle", () => ({
  LargeSearchToggle: () => null,
  SearchToggle: () => null,
}));
vi.mock("fumadocs-ui/components/layout/sidebar", () => ({
  SidebarTrigger: () => null,
}));
vi.mock("@/components/docs/ask-ai", () => ({ AskAiTrigger: () => null }));

it("keeps the docs home link accessible and renders the approved shaded pixels at navigation size", async () => {
  const markup = renderToStaticMarkup(createElement(DocsHeader, {
    tabs: [{ title: "Docs", url: "/docs" }, { title: "SDK", url: "/docs/sdk" }],
  }));
  expect(markup).toContain('aria-label="Stigmer documentation home"');
  const logo = markup.match(/<a[^>]*aria-label="Stigmer documentation home"[^>]*>(.*?)<\/a>/)?.[1];
  expect(logo).toContain('width="32" height="32"');
  expect(logo).not.toMatch(/<(?:defs|mask)\b|url\(#/);
  const source = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../brand/logo-shaded-white.svg"));
  const pixels = (svg: string | Buffer) => sharp(Buffer.from(svg)).resize(32, 32).ensureAlpha().raw().toBuffer();
  expect(await pixels(logo!)).toEqual(await pixels(source));
});
