"use client";

import { useMemo } from "react";
import { useCheckPermission } from "../grant/useCheckPermission.js";

/** Return value of {@link useCanCreateFile}. */
export interface UseCanCreateFileReturn {
  /** Whether the viewer may upload a File to the organization; `false` until the server has answered. */
  readonly allowed: boolean;
  /** `true` while the server's answer is in flight. */
  readonly isLoading: boolean;
}

/**
 * Mirrors the server's File upload bar, `can_create_file` on the
 * organization (its members and guests hold it), so an Upload affordance
 * never appears to someone whose upload would be refused.
 *
 * `allowed` stays `false` while the check is in flight, so the button never
 * shows and then vanishes; after that the check's fail-open answer holds,
 * so an outage of the check never hides the affordance, and the server
 * refuses an upload the answer missed. On a server without sign-in every
 * check answers allowed.
 *
 * Pass `null` for `org` while it loads: `allowed` stays `false`.
 *
 * @param org  The organization's id, or `null` while loading.
 */
export function useCanCreateFile(org: string | null): UseCanCreateFileReturn {
  const { allowed, isLoading } = useCheckPermission(
    org ? { kind: "organization", id: org } : null,
    "can_create_file",
  );
  return useMemo(
    () => ({ allowed: !!org && !isLoading && allowed, isLoading: !!org && isLoading }),
    [org, allowed, isLoading],
  );
}
