"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  SkillUploader,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";

/**
 * Console page for uploading a new skill package.
 *
 * Mounted at `/library/skills/new`. Renders the SDK's
 * `SkillUploader` component and handles routing on
 * completion (navigate to detail) and cancellation (navigate to list).
 */
export function SkillNewPage() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("Upload skill");
  }, [setLabel]);

  if (!org) return null;

  return (
    <SkillUploader
      org={org}
      onComplete={(skill) =>
        router.push(
          `/library/skills/${skill.metadata?.org}/${skill.metadata?.slug}`,
        )
      }
      onCancel={() => router.push("/library/skills")}
      className="min-h-[320px]"
    />
  );
}
