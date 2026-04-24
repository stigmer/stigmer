/**
 * Console-specific draft session URL builders.
 *
 * The core draft types, CREATOR_AGENTS constant, and parsing functions
 * now live in `@stigmer/react` (SDK). This file re-exports them for
 * backward compatibility and provides Console-specific URL builders.
 */
export type { DraftResourceType, DraftParams } from "@stigmer/react";
export { CREATOR_AGENTS, parseDraftType, parseDraftParams } from "@stigmer/react";

/**
 * Build a Console URL that navigates to the SessionLauncher with the
 * specified system agent pre-selected.
 *
 * @example
 * ```tsx
 * import Link from "next/link";
 * import { getDraftSessionUrl } from "@/domain/session/draft-session";
 *
 * <Link href={getDraftSessionUrl("agent")}>Add Agent</Link>
 * ```
 */
export function getDraftSessionUrl(resourceType: string): string {
  return `/?draft=${resourceType}`;
}

/**
 * Build a Console URL that opens an edit session for an existing resource.
 *
 * @example
 * ```tsx
 * import Link from "next/link";
 * import { getEditSessionUrl } from "@/domain/session/draft-session";
 *
 * <Link href={getEditSessionUrl("agent", "acme", "my-agent")}>Edit</Link>
 * ```
 */
export function getEditSessionUrl(
  resourceType: string,
  org: string,
  slug: string,
): string {
  return `/?draft=${resourceType}&editOrg=${encodeURIComponent(org)}&editSlug=${encodeURIComponent(slug)}`;
}
