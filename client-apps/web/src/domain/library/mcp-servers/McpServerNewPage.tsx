"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  McpServerCreationWizard,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";

/**
 * Console page for creating a new MCP server via the wizard.
 *
 * Mounted at `/library/mcp-servers/new`. Renders the SDK's
 * `McpServerCreationWizard` component and handles routing on
 * completion (navigate to detail) and cancellation (navigate to list).
 */
export function McpServerNewPage() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("New MCP server");
  }, [setLabel]);

  if (!org) return null;

  return (
    <McpServerCreationWizard
      org={org}
      onComplete={(result) =>
        router.push(`/library/mcp-servers/${result.org}/${result.slug}`)
      }
      onCancel={() => router.push("/library/mcp-servers")}
      className="min-h-[480px]"
    />
  );
}
