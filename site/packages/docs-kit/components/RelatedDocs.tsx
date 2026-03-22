import { Card, Cards } from "fumadocs-ui/components/card";

export interface RelatedDocLink {
  /** Link URL — relative .mdx path or absolute URL */
  href: string;
  /** Display title shown on the card */
  title: string;
  /** Short description of what the linked page covers */
  description: string;
}

export interface RelatedDocsProps {
  /** Links to related documentation pages */
  links: RelatedDocLink[];
}

/**
 * Navigation card grid for end-of-page "Further reading" sections.
 *
 * The heading belongs in MDX (`## Further reading`) so it appears in the
 * Fumadocs table of contents. This component renders only the card grid.
 *
 * Composes Fumadocs Card/Cards internally — we reuse the ecosystem instead
 * of reinventing card styling.
 */
export function RelatedDocs({ links }: RelatedDocsProps) {
  return (
    <Cards>
      {links.map((link) => (
        <Card
          key={link.href}
          href={link.href}
          title={link.title}
          description={link.description}
        />
      ))}
    </Cards>
  );
}
