/**
 * A section of a release's notes, drawn for the Releases page.
 *
 * The notes are Markdown written for GitHub. They are rendered by the
 * Markdown renderer Fumadocs ships (`fumadocs-core/content`: remark with
 * GitHub's extensions, so a bare URL becomes a link), not by a parser of our
 * own, so notes that one day use a numbered list or a code block still read
 * as written. It is awaited once per section, when the page is built, and
 * hands back plain elements: nothing is set as raw HTML.
 *
 * Three things differ from what the renderer does alone:
 *   - Text in angle brackets ("Allow all <class>") is kept as the words it
 *     is. Markdown reads it as raw HTML, which the renderer drops.
 *   - A link is drawn only for an http(s) address. Anything else (a path
 *     that only resolves on GitHub, another scheme) keeps its words and
 *     loses the link.
 *   - A bare URL shows without its scheme.
 */
import type { ComponentProps, ReactNode } from "react";
import { Markdown } from "fumadocs-core/content";
import { SCROLL_REGION } from "@/lib/scroll-region";
import { cn } from "@/lib/utils";

/** Inline code, as the page's own words and the notes both set it. */
export const INLINE_CODE =
  "rounded-[3px] bg-muted px-[0.35em] py-[0.1em] font-mono text-[0.86em] text-foreground [overflow-wrap:anywhere]";

const LIST = "mt-2.5 flex flex-col gap-2.5 pl-[18px] [&_ol]:mt-2 [&_ol]:gap-1.5 [&_ul]:mt-2 [&_ul]:gap-1.5";

/** The part of a Markdown tree this file reads. */
interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
}

/** A remark plugin: every raw HTML node becomes the text it was written as. */
function rawHtmlAsText() {
  const visit = (node: MarkdownNode): void => {
    if (node.type === "html") node.type = "text";
    node.children?.forEach(visit);
  };
  return visit;
}

function NoteLink({ href, children }: ComponentProps<"a">) {
  if (!href || !/^https?:\/\//.test(href)) return <>{children}</>;
  return (
    <a
      href={href}
      className="text-foreground underline underline-offset-[3px] [overflow-wrap:anywhere] hover:text-foreground/80"
    >
      {children === href ? href.replace(/^https?:\/\//, "") : children}
    </a>
  );
}

const COMPONENTS = {
  a: NoteLink,
  strong: ({ children }: ComponentProps<"strong">) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ children }: ComponentProps<"code">) => <code className={INLINE_CODE}>{children}</code>,
  // A block that scrolls sideways is a Tab stop (lib/scroll-region.ts), so a
  // long code line or a wide table is in reach of the keyboard and never
  // widens the page.
  pre: ({ children }: ComponentProps<"pre">) => (
    <pre
      {...SCROLL_REGION}
      className={cn(
        "overflow-x-auto rounded border border-border bg-card p-3 [&_code]:bg-transparent [&_code]:p-0",
        SCROLL_REGION.className,
      )}
    >
      {children}
    </pre>
  ),
  table: ({ children }: ComponentProps<"table">) => (
    <div {...SCROLL_REGION} className={cn("overflow-x-auto", SCROLL_REGION.className)}>
      <table className="[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground">
        {children}
      </table>
    </div>
  ),
  ul: ({ children }: ComponentProps<"ul">) => <ul className={`list-disc ${LIST}`}>{children}</ul>,
  ol: ({ children }: ComponentProps<"ol">) => <ol className={`list-decimal ${LIST}`}>{children}</ol>,
};

/** One section's Markdown as elements, ready to place in the page. */
export async function renderReleaseNotes(markdown: string): Promise<ReactNode> {
  return Markdown({ children: markdown, remarkPlugins: [rawHtmlAsText], components: COMPONENTS });
}
