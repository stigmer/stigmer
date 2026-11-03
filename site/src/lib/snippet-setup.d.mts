/**
 * Type surface of snippet-setup.mjs for TypeScript importers (the site's
 * remark plugin and markdown exports). Keep these signatures in step with
 * the module's exports.
 */

/** The marker line that ends a fence's setup, by the fence's language as written on the page. */
export const SETUP_MARKERS: Readonly<Record<string, string>>;

/** A fence's text split at its marker: the hidden setup, the shown body, and how many lines are hidden. */
export interface SnippetSetupSplit {
  readonly setup: string;
  readonly body: string;
  readonly hiddenLines: number;
}

/** Splits a fence's text at its `---cut---` marker; a fence without one is all body. */
export function splitSnippetSetup(lang: string | null | undefined, text: string): SnippetSetupSplit;
