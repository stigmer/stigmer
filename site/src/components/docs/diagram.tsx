/**
 * A drawing in the docs, by name: `<Diagram name="job-path" />`.
 *
 * Each name is a drawing in the site's own language (the list and each
 * one's text are src/components/visuals/diagrams.ts). A name the list does
 * not hold throws, so the static build fails on the page that asked, as a
 * `<Screen>` does. The markdown exports carry the drawing's text in the
 * tag's place.
 *
 * `not-prose` opts the drawing out of DocsBody's `prose` typography, which
 * would otherwise number its lists and space its boxes. The vertical margin
 * sets it off from the paragraphs round it, and drops where the drawing is
 * the only thing in its slot, as in the front page's hero.
 */
import type { ComponentType } from "react";
import { JobPath } from "@/components/visuals/JobPath";
import { diagram, type DiagramName } from "@/components/visuals/diagrams";

const DRAWN: Record<DiagramName, ComponentType> = {
  "job-path": JobPath,
};

export interface DiagramProps {
  /** The drawing's name in src/components/visuals/diagrams.ts. */
  name: string;
}

export function Diagram({ name }: DiagramProps) {
  const Drawn = DRAWN[diagram(name).name];
  return (
    <div data-diagram={name} className="not-prose my-8 first:mt-0 last:mb-0">
      <Drawn />
    </div>
  );
}
