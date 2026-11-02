/**
 * The drawings the docs show, by name, and the text each one stands for.
 *
 * A docs page shows a drawing as `<Diagram name="…" />` (src/components/docs/
 * diagram.tsx), the way it shows a screen as `<Screen name="…" alt="…" />`.
 * The markdown exports (the per-page `.md`, llms-full.txt, the "Copy page"
 * button and Ask AI) carry each drawing's text in its place
 * (`cleanContent` in src/lib/llms-pages.ts), so a reader that cannot see the
 * picture reads what it says. Each text is built in the drawing's own data
 * file from the words the drawing draws, so the two cannot disagree.
 *
 * Data only, with relative imports: the export reads this module under
 * `tsx`, outside the site's bundler.
 */
import { CAPTION as JOB_PATH_TEXT } from "./job-path";

/** Each drawing's name and the text the exports carry in its place. */
export const DIAGRAMS = {
  "job-path": { text: () => JOB_PATH_TEXT },
} as const satisfies Record<string, { text: () => string }>;

export type DiagramName = keyof typeof DIAGRAMS;

/** Whether a name is a drawing the docs hold. */
export function isDiagramName(name: string): name is DiagramName {
  return Object.hasOwn(DIAGRAMS, name);
}

/** The drawing `name` names, with its text; a name the list does not hold fails the build that asked for it. */
export function diagram(name: string): { name: DiagramName; text: string } {
  if (!isDiagramName(name)) {
    const known = Object.keys(DIAGRAMS)
      .map((entry) => `"${entry}"`)
      .join(", ");
    throw new Error(`no diagram named "${name}"; the docs draw ${known} (site/src/components/visuals/diagrams.ts)`);
  }
  return { name, text: DIAGRAMS[name].text() };
}
