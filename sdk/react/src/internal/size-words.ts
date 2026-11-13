// How a File's size reads beside its kind on a card: the turn's Made cards
// ("Markdown · 4.1 KB") and the plan card ("Plan · 312 B") say it the same
// way. It is `formatFileSize`'s reading, except that an unknown or empty
// size says nothing, so a card never reads "0 B".

import { formatFileSize } from "../file/file-size.js";

/** A File's size in words ("312 B", "4.1 KB", "3.0 MB"), or "" when it is unknown or zero. */
export function sizeWords(bytes: bigint | number | undefined): string {
  const n = Number(bytes ?? 0);
  return n > 0 ? formatFileSize(n) : "";
}
