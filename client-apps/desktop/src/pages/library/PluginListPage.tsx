/**
 * The desktop app's Plugins list: the kit's section, opened at the
 * resource's address and linked with the router. `?add=mcp-server` opens the
 * "Add MCP server" form on arrival, which is how the Library's Add menu
 * reaches it.
 */

import { useSearchParams } from "react-router-dom";
import { LIBRARY_ADD_MCP_SERVER, LIBRARY_ADD_PARAM, LibraryPluginsSection } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "../../journey/journey-links";
import { useLibraryOpen } from "./library-open";

export default function PluginListPage() {
  const onOpen = useLibraryOpen();
  const [searchParams] = useSearchParams();
  return (
    <LibraryPluginsSection
      onOpen={onOpen}
      renderLink={renderJourneyLink}
      addMcpServerOnArrival={searchParams.get(LIBRARY_ADD_PARAM) === LIBRARY_ADD_MCP_SERVER}
    />
  );
}
