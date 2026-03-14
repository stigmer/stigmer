"use client";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { TopBar } from "@/components/layout/TopBar";
import { ResourceList } from "@/components/catalog";
import { useResourceCatalog } from "@/hooks/useResourceCatalog";

export const dynamic = "force-dynamic";

export default function SkillsPage() {
  const catalog = useResourceCatalog(ApiResourceKind.skill);

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
