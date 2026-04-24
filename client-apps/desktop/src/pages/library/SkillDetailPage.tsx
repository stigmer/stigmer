import { useParams } from "react-router-dom";
import { SkillDetailView } from "@stigmer/react";

export default function SkillDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();

  if (!org || !slug) return null;

  return (
    <div className="h-full overflow-y-auto p-6">
      <SkillDetailView org={org} slug={slug} />
    </div>
  );
}
