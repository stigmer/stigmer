"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import { useMcpServerDetail } from "@/hooks/useMcpServerDetail";
import { McpServerDetailView } from "@/components/mcp-server/McpServerDetailView";

export default function McpServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { mcpServer, isLoading, error } = useMcpServerDetail(id);

  return (
    <div className="space-y-6">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-3">
        <Link
          href="/mcp-servers"
          aria-label="Back to MCP servers"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">
          {mcpServer?.metadata?.name ?? "MCP Server"}
        </h1>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Content */}
      {mcpServer && <McpServerDetailView mcpServer={mcpServer} />}
    </div>
  );
}
