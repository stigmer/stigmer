"use client";

import { Loader2 } from "lucide-react";
import { ErrorMessage } from "@/components/ui/error-message";
import { TopBar } from "@/components/layout/TopBar";
import { useMcpServer } from "@/hooks/mcp-servers/useMcpServer";
import { McpServerDetailView } from "@/components/mcp-server/McpServerDetailView";
import { useDynamicRouteId } from "@/hooks/useDynamicRouteId";

export default function McpServerDetailPage() {
  const id = useDynamicRouteId();
  const { data: mcpServer, isLoading, error, refetch } = useMcpServer(id);

  const name = mcpServer?.metadata?.name ?? "MCP Server";

  return (
    <div className="space-y-6">
      <TopBar
        title={name}
        breadcrumbs={[
          { label: "MCP Servers", href: "/mcp-servers" },
          { label: name },
        ]}
      />

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      )}

      {error && <ErrorMessage error={error} retry={refetch} />}

      {mcpServer && <McpServerDetailView mcpServer={mcpServer} />}
    </div>
  );
}
