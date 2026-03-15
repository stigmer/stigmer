"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { TopBar } from "@/components/layout/TopBar";
import { ResourceList } from "@/components/catalog";
import { useResourceCatalog } from "@/hooks/useResourceCatalog";

export default function AgentsPage() {
  const catalog = useResourceCatalog(ApiResourceKind.agent);

  return (
    <>
      <TopBar
        title="Agents"
        description="Browse and search the agent catalog"
        actions={
          <Link
            href="/run"
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          >
            <Play className="size-3.5" />
            Run Agent
          </Link>
        }
      />
      <ResourceList kind={ApiResourceKind.agent} catalog={catalog} />
    </>
  );
}
