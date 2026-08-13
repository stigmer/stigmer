/**
 * Select an element's text content, replacing any existing selection.
 *
 * The honest fallback for one-time secret reveals (API keys, invite URLs,
 * client secrets) when the clipboard write is rejected (insecure context,
 * denied permission): instead of claiming "Copied" for a copy that didn't
 * happen, the revealed value is selected so the user can copy it manually.
 * Pair with `useCopyFeedback` — branch on its `copy()` result.
 */
export function selectElementText(el: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}
