"use client";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { TopBar } from "@/components/layout/TopBar";
import { ResourceList } from "@/components/catalog";
import { useSkillList } from "@/hooks/skills/useSkillList";

export default function SkillsPage() {
  const catalog = useSkillList();

  return (
    <>
      <TopBar
        title="Skills"
        description="Browse and search the skill catalog"
      />
      <ResourceList kind={ApiResourceKind.skill} catalog={catalog} />
    </>
  );
}
