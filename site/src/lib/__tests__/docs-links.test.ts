/**
 * Every link to the docs goes to a page the site serves, and every docs
 * redirect lands on one.
 *
 * The docs lane's link checker reads the pages too, but it only warns, so a
 * page moved without its links following once shipped them broken, silently.
 * This asks `servedPath` of every link to a docs page written in a published
 * docs page, in a blog post and in the site's own code, and fails naming the
 * file and the link. A link is read the way the reader's browser reads it: a
 * relative link to a page file (`./get.mdx`) from the file's own folder, as the
 * docs framework resolves it, and any other relative link (`./get`) from the
 * page's address, so one written on a topic's own page (`/docs/environments`,
 * a folder's `index.mdx`) lands one folder higher than its file suggests
 * (`docs/STYLE.md`, "Links").
 *
 * The redirect file's own rule is held the same way: each docs line sends to a
 * served page, never to an address the file moves again, and a moved page
 * carries its three forms (the page, its trailing slash, its Markdown twin).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { servedPath } from "@/__test-utils__/site-paths";
import { collectDocsPages, markdownExportUrl } from "../llms-pages";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, "../../../../docs");
const BLOG = join(HERE, "../../../../blog");
const SITE_SRC = join(HERE, "../..");
const REDIRECTS = join(HERE, "../../../public/_redirects");
const ORIGIN = "https://stigmer.ai";

/** The page's text with its code blocks and code spans blanked: a link there is an example, not a link. */
function prose(text: string): string {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");
}

/** Every link target written in a page: Markdown links and `href` attributes. */
function linksIn(text: string): string[] {
  const body = prose(text);
  const markdown = [...body.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]);
  const attributes = [...body.matchAll(/\bhref=(?:\{\s*)?["']([^"']+)["']/g)].map((m) => m[1]);
  return [...markdown, ...attributes];
}

/**
 * The site path a link written in `file` (shown at `pageUrl`) reaches, or
 * null when it leaves the site or stays on the page.
 */
function siteTarget(link: string, file: string, pageUrl: string): string | null {
  if (link.startsWith("#") || /^(mailto|tel):/.test(link)) return null;
  if (/^https?:\/\//.test(link)) {
    const url = new URL(link);
    return url.hostname === "stigmer.ai" || url.hostname === "www.stigmer.ai" ? url.pathname + url.hash : null;
  }
  if (link.startsWith("/")) return link;
  if (/\.mdx?(#|$)/.test(link)) {
    // The docs framework resolves a relative link to a page file from the file's folder.
    const [target, hash] = link.split("#");
    const file_ = posix.normalize(posix.join(posix.dirname(file), target)).replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "");
    return `/docs${file_ ? `/${file_}` : ""}${hash ? `#${hash}` : ""}`;
  }
  const url = new URL(link, `${ORIGIN}${pageUrl}`);
  return url.pathname + url.hash;
}

/** A docs page's own file, relative to docs/. */
function pageFile(relativePath: string): string {
  if (relativePath === "") return "index.mdx";
  return existsSync(join(DOCS, `${relativePath}.mdx`)) ? `${relativePath}.mdx` : `${relativePath}/index.mdx`;
}

/** The docs links in `text` that `servedPath` refuses, as "<file>: <link>". */
function unservedIn(text: string, file: string, docsFile: string, pageUrl: string): string[] {
  return linksIn(text)
    .map((link) => [link, siteTarget(link, docsFile, pageUrl)] as const)
    .filter(([, target]) => target !== null && (target === "/docs" || target.startsWith("/docs/") || target.startsWith("/docs#")))
    .filter(([, target]) => !servedPath(target as string))
    .map(([link, target]) => `${file}: ${link}${link === target ? "" : ` (reaches ${target})`}`);
}

/** The site's own source files: not its tests or their helpers. */
function siteSources(): string[] {
  const listed = execFileSync("git", ["ls-files", "--", "."], { cwd: SITE_SRC, encoding: "utf8" });
  return listed
    .split("\n")
    .filter((file) => /\.(ts|tsx|mjs)$/.test(file))
    .filter((file) => !/(^|\/)(__tests__|__test-utils__|__fixtures__)\//.test(file) && !/\.test\.(ts|tsx|mjs)$/.test(file));
}

interface RedirectRule {
  from: string;
  to: string;
  status: string;
  line: number;
}

function docsRedirects(): RedirectRule[] {
  return readFileSync(REDIRECTS, "utf8")
    .split("\n")
    .map((text, index) => ({ fields: text.trim().split(/\s+/), line: index + 1 }))
    .filter(({ fields }) => fields[0]?.startsWith("/docs"))
    .map(({ fields, line }) => ({ from: fields[0], to: fields[1], status: fields[2], line }));
}

describe("links to the docs", () => {
  it("go to a served page from every published docs page", async () => {
    const pages = await collectDocsPages(DOCS, ORIGIN);
    expect(pages.length).toBeGreaterThan(100);
    const unserved = pages.flatMap((page) => {
      const file = pageFile(page.relativePath);
      const pageUrl = page.relativePath ? `/docs/${page.relativePath}` : "/docs";
      return unservedIn(readFileSync(join(DOCS, file), "utf8"), `docs/${file}`, file, pageUrl);
    });
    expect(unserved, "each link names a page that moved or never existed: link its current address (site/public/_redirects says where a moved page went)").toEqual([]);
  });

  it("go to a served page from every blog post", () => {
    const posts = readdirSync(BLOG).filter((file) => file.endsWith(".mdx"));
    expect(posts.length).toBeGreaterThan(0);
    const unserved = posts.flatMap((post) =>
      unservedIn(readFileSync(join(BLOG, post), "utf8"), `blog/${post}`, "", `/blog/${post.replace(/\.mdx$/, "")}`),
    );
    expect(unserved).toEqual([]);
  });

  it("go to a served page from the site's own code", () => {
    const sources = siteSources();
    expect(sources.length).toBeGreaterThan(0);
    const unserved = sources.flatMap((file) => {
      const text = readFileSync(join(SITE_SRC, file), "utf8");
      // A whole quoted address; one ending in "/" is a prefix the code tests against, not a link.
      return [...text.matchAll(/"(\/docs(?:[/#][\w./#-]*)?)"/g)]
        .map((m) => m[1])
        .filter((target) => !target.endsWith("/") && !servedPath(target))
        .map((target) => `site/src/${file}: ${target}`);
    });
    expect(unserved).toEqual([]);
  });
});

describe("the docs redirects in site/public/_redirects", () => {
  const rules = docsRedirects();

  it("send every old address to a page the site serves, permanently", () => {
    expect(rules.length).toBeGreaterThan(0);
    const wrong = rules
      .filter((rule) => rule.status !== "301" || !servedPath(rule.to))
      .map((rule) => `line ${rule.line}: ${rule.from} -> ${rule.to} ${rule.status}`);
    expect(wrong, "a target must be served, not itself moved (point at where it went) or missing").toEqual([]);
  });

  it("move only addresses no page answers any more", () => {
    const shadowed = rules
      .map((rule) => ({ rule, page: rule.from.replace(/\.md$/, "").replace(/\/$/, "").slice("/docs/".length) }))
      .filter(({ page }) => page !== "" && (existsSync(join(DOCS, `${page}.mdx`)) || existsSync(join(DOCS, page, "index.mdx"))))
      .map(({ rule }) => `line ${rule.line}: ${rule.from}`);
    expect(shadowed).toEqual([]);
  });

  it("move each page with its trailing slash and its Markdown twin, to the same place", () => {
    const byFrom = new Map(rules.map((rule) => [rule.from, rule.to]));
    const pages = new Set(rules.map((rule) => rule.from.replace(/\.md$/, "").replace(/\/$/, "")));
    const missing = [...pages].flatMap((page) => {
      const to = byFrom.get(page);
      if (to === undefined) return [`${page}: no line for the page itself`];
      const forms: Array<[string, string]> = [
        [`${page}/`, to],
        [`${page}.md`, markdownExportUrl(to)],
      ];
      return forms.filter(([from, want]) => byFrom.get(from) !== want).map(([from, want]) => `${from} -> ${want}`);
    });
    expect(missing, "add the missing lines (the file's header: a page's Markdown twin and its trailing-slash form move with it)").toEqual([]);
  });
});

