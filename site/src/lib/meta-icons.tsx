import type { ReactNode } from "react";
import { SquareCode, SquareTerminal, type LucideIcon } from "lucide-react";

/**
 * Icons that `meta.json` files may reference by name through their `icon`
 * field (e.g. `{ "icon": "SquareTerminal" }`).
 *
 * Fumadocs renders meta.json icons only when the content loader is configured
 * with a resolver (see `source.ts`), and the resolver can only render icons it
 * knows about. Keeping an explicit registry — instead of importing lucide's
 * full `icons` map — keeps the icon set tree-shakeable and makes every icon
 * used by the docs tree greppable from one place.
 */
const metaIcons: Record<string, LucideIcon> = {
  SquareCode,
  SquareTerminal,
};

/**
 * Resolves a meta.json `icon` name to a rendered lucide icon.
 *
 * Unknown names fail the build rather than silently rendering nothing, so a
 * typo in meta.json is caught at build time instead of shipping as a missing
 * icon.
 */
export function resolveMetaIcon(icon: string | undefined): ReactNode {
  if (icon === undefined) return undefined;
  const Icon = metaIcons[icon];
  if (Icon === undefined) {
    throw new Error(
      `Unknown icon "${icon}" in meta.json — add it to the registry in site/src/lib/meta-icons.tsx.`,
    );
  }
  return <Icon />;
}
