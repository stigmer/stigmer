"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { ResourceListView } from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { samples } from "@stigmer/react/demo";
import { DEMO_CONTENT_ZOOM } from "../shared/tokens";

const EXISTING_SERVERS = [
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000001",
    kind: ApiResourceKind.mcp_server,
    name: "GitHub",
    slug: "github",
    description: "Repository management, issues, and pull requests.",
  }),
  samples.searchResult({
    id: "mcp-00000000-0000-0000-0000-000000000002",
    kind: ApiResourceKind.mcp_server,
    name: "Slack Notifications",
    slug: "slack-notifications",
    description: "Send messages and manage channels via Slack API.",
  }),
];

const NEW_SERVER = samples.searchResult({
  id: "mcp-00000000-0000-0000-0000-000000000003",
  kind: ApiResourceKind.mcp_server,
  name: "Order Management API",
  slug: "order-management-api",
  description:
    "REST API for order lookup, inventory, and return processing.",
});

interface McpServersListViewProps {
  highlightCreate?: boolean;
  showNewServer?: boolean;
}

export function McpServersListView({
  highlightCreate,
  showNewServer,
}: McpServersListViewProps) {
  const items = useMemo(
    () => (showNewServer ? [...EXISTING_SERVERS, NEW_SERVER] : EXISTING_SERVERS),
    [showNewServer],
  );

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">MCP Servers</h3>
        <div className="relative" data-cursor-target="create-mcp-server">
          <div className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
            <Plus className="h-3 w-3" />
            Add MCP Server
          </div>

          {highlightCreate && (
            <motion.span
              className="absolute inset-0 rounded-md border border-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.5, 0] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              aria-hidden
            />
          )}
        </div>
      </div>

      <div className="relative" style={{ zoom: DEMO_CONTENT_ZOOM }}>
        <ResourceListView items={items} isLoading={false} />
        {showNewServer && <NewServerHighlight />}
      </div>
    </div>
  );
}

function NewServerHighlight() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[52px] rounded-md bg-primary/5"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: 2, ease: "easeInOut" }}
      aria-hidden
    />
  );
}
