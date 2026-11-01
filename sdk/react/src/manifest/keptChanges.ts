// The words the YAML dialogs use for a declared change a kind cannot make:
// a slug on a kind with no rename, a visibility on a kind with no
// `updateVisibility`. The resource keeps what it has and the rest of the
// document applies; both dialogs say so before Apply is pressed, from the
// target `stigmer.manifest.resolveTarget` answered, in the same sentences.
// Pinned through the dialogs' tests.

/** What a document declares that its kind will not change. */
export interface KeptChanges {
  readonly slugKept: boolean;
  readonly visibilityKept: boolean;
}

/**
 * One sentence per declared change the kind keeps, in the order a reader
 * meets them in the document (slug, then visibility); empty when the
 * apply makes every declared change.
 */
export function keptChangeSentences(displayName: string, kept: KeptChanges): string[] {
  const sentences: string[] = [];
  if (kept.slugKept) {
    sentences.push(`${displayName} slugs do not change, so it keeps this slug.`);
  }
  if (kept.visibilityKept) {
    sentences.push(`${displayName} visibility does not change, so it keeps its visibility.`);
  }
  return sentences;
}
