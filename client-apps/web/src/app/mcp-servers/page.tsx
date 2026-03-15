"use client";

import { TopBar } from "@/components/layout/TopBar";
import { ResourceList, McpServerSearchCard } from "@/components/resource-list";
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
        renderItem={(result) => <McpServerSearchCard result={result} />}
      />
    </>
  );
}
