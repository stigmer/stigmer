import type { ReactNode } from "react";

interface HeroProps {
  /** Muted uppercase label above the headline (e.g. "Get started"). */
  eyebrow: string;
  /** The page headline. Rendered as the page's `h1`. */
  title: string;
  /** One-line pitch under the headline. Plain language — widest audience. */
  description?: string;
  /**
   * Media slot rendered below the text block — typically a `<ScenarEmbed>`
   * product tour. Optional so a hero page can ship text-only.
   */
  children?: ReactNode;
}

/**
 * Landing-page header for docs pages that own their header (`hero: true` in
 * frontmatter, which suppresses the default DocsTitle/DocsDescription row —
 * see `app/docs/[[...slug]]/page.tsx`). Renders the page `h1`, so exactly one
 * Hero belongs on a page, at the top.
 *
 * `not-prose` opts out of DocsBody's `prose` typography: the eyebrow/headline
 * scale here is deliberate (matching the marketing Hero's bold, tight-tracked
 * display style) and must not be restyled by prose defaults.
 */
export function Hero({ eyebrow, title, description, children }: HeroProps) {
  return (
    <header className="not-prose">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
        {eyebrow}
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-fd-foreground sm:text-4xl">
        {title}
      </h1>
      {description ? (
        <p className="mt-4 max-w-2xl text-base text-fd-muted-foreground sm:text-lg">
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-8">{children}</div> : null}
    </header>
  );
}
