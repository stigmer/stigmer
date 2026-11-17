"use client";

// How a settings line names the organization it is about: by its slug on a
// server that holds several, and as "this organization" on one that holds
// one (the open-source edition never names its organization), while the
// server's answer loads, or where no organization is known.

import { useSingleOrg } from "../server-info.js";
import { useOptionalOrg } from "./OrgProvider.js";

/** What a line says where the organization is not named. */
export const UNNAMED_ORGANIZATION = "this organization";

/**
 * The organization's name for a sentence: `slug` (or the active
 * organization's) only once the server says it holds several organizations.
 *
 * @internal Used by the settings pages; not part of the public API.
 */
export function useOrgDisplayName(slug?: string): string {
  const singleOrg = useSingleOrg();
  const activeSlug = useOptionalOrg()?.activeOrg?.metadata?.slug;
  const named = slug || activeSlug;
  return singleOrg === false && named ? named : UNNAMED_ORGANIZATION;
}
