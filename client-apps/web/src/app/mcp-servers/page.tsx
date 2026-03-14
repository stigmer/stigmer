"use client";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { TopBar } from "@/components/layout/TopBar";
import { ResourceList } from "@/components/catalog";
import { useResourceCatalog } from "@/hooks/useResourceCatalog";

export default function McpServersPage() {
  const catalog = useResourceCatalog(ApiResourceKind.mcp_server);

  return (
    <>
      <TopBar
        title="MCP Servers"
        description="Browse and search MCP server configurations"
      />
      <ResourceList kind={ApiResourceKind.mcp_server} catalog={catalog} />
    </>
  );
}
