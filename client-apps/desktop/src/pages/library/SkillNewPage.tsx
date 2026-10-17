import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  SkillUploader,
  useBreadcrumbOverride,
  useActiveOrgId,
  useOrgSlugForId,
} from "@stigmer/react-sdk";

export default function SkillNewPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("Upload skill");
    return () => setLabel(null);
  }, [setLabel]);

  if (!org) return null;

  return (
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
  );
}
