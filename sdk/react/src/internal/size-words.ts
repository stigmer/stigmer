// How a File's size reads beside its kind on a card: the turn's Made cards
// ("Markdown · 4.1 KB"), the plan card ("Plan · 0.3 KB") and the file window
// say it the same way: kilobytes from the first byte, one decimal under ten
// of a unit, whole above. An unknown or empty size says nothing, so a card
// never reads "0 B". `formatFileSize` (public) keeps its exact reading.

/** The units a size is said in, a kilobyte the smallest: a person reads "0.9 KB", not "920 B". */
const UNITS = ["KB", "MB", "GB", "TB"] as const;

/**
 * A File's size in words, as the session view says it: one decimal under ten
 * of a unit, whole above ("0.9 KB", "4.1 KB", "412 KB", "3.2 MB"), or "" when
 * it is unknown or zero.
 */
export function sizeWords(bytes: bigint | number | undefined): string {
  const n = Number(bytes ?? 0);
  if (!(n > 0)) return "";
  let value = n / 1024;
  let unit = 0;
  // 1023.6 KB would round to "1024 KB": it is said in the next unit.
  while (value >= 1023.5 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = value < 10 ? Math.max(value, 0.1).toFixed(1) : String(Math.round(value));
  return `${shown} ${UNITS[unit]}`;
}
