import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

export type { ClassValue };

/**
 * SDK utility class prefix (stigmer/stigmer#454).
 *
 * Every Tailwind utility authored inside the SDK carries this variant-style
 * prefix (`stg:flex`), so the published stylesheet shares no class names with
 * a host application's own Tailwind build. The prefix is deliberately NOT
 * `stgm`: Tailwind v4 prefixes theme variables too, and a `stgm` prefix would
 * collide with the `--stgm-*` token namespace (`--stgm-font-sans`,
 * `--stgm-shadow-sm`) that `@stigmer/theme` already owns.
 */
export const UTILITY_PREFIX = "stg:";

/**
 * tailwind-merge configured so the `stg:` prefix is TRANSPARENT for conflict
 * grouping. This preserves the SDK's `className` override contract: hosts
 * pass their own unprefixed utilities (`p-4`), and they must still displace
 * the SDK's prefixed defaults (`stg:p-2`) — the two spellings target the same
 * CSS property, so they must resolve as the same conflict group even though
 * their class names differ. Without this hook, both classes would survive the
 * merge and the SDK's higher cascade layer would silently win, breaking the
 * documented override channel (DD-019).
 */
const twMergeWithPrefix = extendTailwindMerge({
  experimentalParseClassName: ({ className, parseClassName }) =>
    parseClassName(
      className.startsWith(UTILITY_PREFIX)
        ? className.slice(UTILITY_PREFIX.length)
        : className,
    ),
});

/**
 * Merge class values with Tailwind-aware conflict resolution.
 *
 * Later inputs win conflicts, across BOTH spellings of a utility: the SDK's
 * prefixed form (`stg:p-2`) and a host's unprefixed form (`p-4`) are the same
 * conflict group, so `cn("stg:p-2", className)` lets a host `className`
 * override SDK defaults exactly as it did before the #454 prefix migration.
 * Non-Tailwind classes pass through untouched.
 */
export function cn(...inputs: ClassValue[]) {
  return twMergeWithPrefix(clsx(inputs));
}
