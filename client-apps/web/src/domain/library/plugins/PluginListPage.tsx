"use client";

/**
 * The web console's Plugins list: the kit's section, opened through the
 * Library overlay's client-side navigation and linked with Next's `Link`.
 * `?add=mcp-server` opens the "Add MCP server" form on arrival, which is how
 * the Library's Add menu reaches it.
 */

import { useSearchParams } from "next/navigation";
import { LIBRARY_ADD_MCP_SERVER, LIBRARY_ADD_PARAM, LibraryPluginsSection } from "@stigmer/react-sdk/console";
import { useLibraryOpen } from "@/domain/library/library-navigation";
import { renderJourneyLink } from "@/domain/journey/journey-links";

export function PluginListPage() {
  const onOpen = useLibraryOpen();
  const searchParams = useSearchParams();
  return (
    <LibraryPluginsSection
      onOpen={onOpen}
      renderLink={renderJourneyLink}
      addMcpServerOnArrival={searchParams.get(LIBRARY_ADD_PARAM) === LIBRARY_ADD_MCP_SERVER}
    />
  );
}
