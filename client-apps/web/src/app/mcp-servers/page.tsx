"use client";

import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { ResourceList } from "@/components/resource-list";
import { ResourceSearchCard } from "@stigmer/react/catalog";
import { useMcpServerList } from "@/hooks/mcp-servers/useMcpServerList";

export default function McpServersPage() {
  const data = useMcpServerList();

  return (
    <>
      <TopBar
        title="MCP Servers"
        description="Browse and search MCP server configurations"
      />
      <ResourceList
        kindLabel="MCP servers"
        data={data}
        layout="grid"
        renderItem={(result) => (
          <Link href={`/mcp-servers/${result.id}`} className="block">
            <ResourceSearchCard result={result} />
          </Link>
        )}
      />
    </>
  );
}
