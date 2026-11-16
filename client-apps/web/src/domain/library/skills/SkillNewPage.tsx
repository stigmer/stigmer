"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  SkillUploader,
  useActiveOrgId,
  useOrgSlugForId,
  useBreadcrumbOverride,
  PageHeader,
} from "@stigmer/react-sdk";

/**
 * Console page for uploading a new skill package.
 *
 * Mounted at `/library/skills/new`. Renders the SDK's
 * `SkillUploader` component and handles routing on
 * completion (navigate to detail) and cancellation (navigate to list).
 */
export function SkillNewPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("Upload skill");
  }, [setLabel]);

  if (!org) return null;

  return (
    <>
      <PageHeader className="mb-6" headingLevel={1} title="Upload skill" description="Every agent in your organization can load a skill when a task needs it." />
      <SkillUploader
        org={org}
        onComplete={(skill) =>
          router.push(
            `/library/skills/${slugForOrg(skill.metadata?.org ?? "")}/${skill.metadata?.slug}`,
          )
        }
        onCancel={() => router.push("/library/skills")}
        className="min-h-[320px]"
      />
    </>
  );
}
