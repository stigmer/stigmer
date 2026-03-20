"use client";

import { useParams } from "next/navigation";
import { SkillDetailView } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";

export function SkillDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const org = useActiveOrgSlug();

  return <SkillDetailView org={org} slug={slug} />;
}
