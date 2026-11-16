import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  SkillUploader,
  SkillCreationDenied,
  useCanCreateSkill,
  useBreadcrumbOverride,
  useActiveOrgId,
  useOrgSlugForId,
  PageHeader,
} from "@stigmer/react-sdk";

export default function SkillNewPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();

  // Only admins upload skills (`can_create_skill`): a member who comes here
  // directly is told who can, never shown an upload the server refuses.
  const { allowed: canUpload, isLoading: isChecking } = useCanCreateSkill(org || null);

  useEffect(() => {
    setLabel("Upload skill");
    return () => setLabel(null);
  }, [setLabel]);

  if (!org || isChecking) return null;
  if (!canUpload)
    return (
      <>
        <PageHeader className="mb-6" headingLevel={1} title="Upload skill" description="Every agent in your organization can load a skill when a task needs it." />
        <SkillCreationDenied />
      </>
    );

  return (
    <>
      <PageHeader className="mb-6" headingLevel={1} title="Upload skill" description="Every agent in your organization can load a skill when a task needs it." />
      <SkillUploader
        org={org}
        onComplete={(skill) =>
          navigate(
            `/library/skills/${slugForOrg(skill.metadata?.org ?? "")}/${skill.metadata?.slug}`,
          )
        }
        onCancel={() => navigate("/library/skills")}
        className="min-h-[320px]"
      />
    </>
  );
}
