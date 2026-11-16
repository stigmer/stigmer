"use client";

// Whether the viewer may upload a skill to an organization: the server's
// `can_create_skill` on the organization (its admins). Asked fail closed, so
// a member is never offered an upload the server refuses.

import { useMemo } from "react";
import { useCheckPermission } from "../grant/useCheckPermission.js";

/** Return value of {@link useCanCreateSkill}. */
export interface UseCanCreateSkillReturn {
  /** Whether the viewer may upload a skill to the organization. */
  readonly allowed: boolean;
  /** `true` while the server's answer is in flight. */
  readonly isLoading: boolean;
}

/**
 * Mirrors the server's bar for uploading a skill, `can_create_skill` on the
 * organization: its admins hold it; a member does not.
 *
 * The answer is the server's own self-check, which asks the authorizer the
 * upload asks, so the console and the server agree in every edition. It
 * fails closed: nothing is offered while the answer is in flight or when the
 * check fails.
 *
 * Pass `null` for `org` while it loads: `allowed` stays `false`.
 *
 * @param org  The organization's id, or `null` while loading.
 *
 * @example
 * ```tsx
 * function UploadSkillLink({ org }: { org: string }) {
 *   const { allowed } = useCanCreateSkill(org);
 *   return allowed ? <a href="/library/skills/new">Upload skill</a> : null;
 * }
 * ```
 */
export function useCanCreateSkill(org: string | null): UseCanCreateSkillReturn {
  const { allowed, isLoading } = useCheckPermission(
    org ? { kind: "organization", id: org } : null,
    "can_create_skill",
    { fail: "closed" },
  );
  return useMemo(
    () => ({ allowed: !!org && allowed, isLoading: !!org && isLoading }),
    [org, allowed, isLoading],
  );
}
