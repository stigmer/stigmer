"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  SkillEditor,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";

/**
 * Console page for creating a new skill via the editor.
 *
 * Mounted at `/library/skills/new`. Renders the SDK's
 * `SkillEditor` component and handles routing on
 * completion (navigate to detail) and cancellation (navigate to list).
 */
export function SkillNewPage() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("New skill");
  }, [setLabel]);

  if (!org) return null;

  return (
    <SkillEditor
      org={org}
      onComplete={(skill) =>
        router.push(
          `/library/skills/${skill.metadata?.org}/${skill.metadata?.slug}`,
        )
      }
      onCancel={() => router.push("/library/skills")}
      className="min-h-[480px]"
    />
  );
}
