/**
 * Where a proof's link goes: a page of the site stays on the site, and a
 * file of the repository opens on GitHub, on `main`, so a visitor reads the
 * test as it is today (brand/__tests__/proofs.test.ts holds the path to a
 * file that exists).
 */
import { SITE_CONFIG } from "@/lib/constants";

/** The address of a site path ("/docs/…") or a repository file ("test/…"). */
export function proofHref(target: string): string {
  return target.startsWith("/") ? target : `${SITE_CONFIG.githubUrl}/blob/main/${target}`;
}

/** The last part of a repository path, as a link names the file. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
