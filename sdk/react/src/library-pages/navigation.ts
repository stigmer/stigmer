// What a Library section needs from the host's router: how to draw a link,
// and how to open a resource's page. The sections write the console's own
// addresses (`/library/<kind>/...`); a host routes them its own way (the web
// console's Library overlay, the desktop app's hash router).

import type { RenderLink } from "../button/LinkButton.js";

/** A Library kind that has a page of its own, as its address names it. */
export type LibraryResourceKind = "agents" | "skills" | "routines" | "plugins" | "environments";

/**
 * The resource a section opens: its kind, the organization as the resource
 * names it (an id, or a slug), and its slug. The host writes the address.
 */
export interface LibraryResourceRef {
  readonly kind: LibraryResourceKind;
  readonly org: string;
  readonly slug: string;
}

/** The routing every Library section takes from its host. */
export interface LibrarySectionNavigation {
  /** Opens a resource's page (a row, View details, a resource just made). */
  readonly onOpen: (resource: LibraryResourceRef) => void;
  /** Draws a link to a console address with the host's router; a plain `<a>` when omitted. */
  readonly renderLink?: RenderLink;
}

/** The query parameter, and its value, that open the Plugins list's "Add MCP server" form on arrival. */
export const LIBRARY_ADD_PARAM = "add";
export const LIBRARY_ADD_MCP_SERVER = "mcp-server";

/** The console's Library addresses the sections link to. */
export const LIBRARY_HREFS = {
  library: "/library",
  agents: "/library/agents",
  newAgent: "/library/agents/new",
  skills: "/library/skills",
  newSkill: "/library/skills/new",
  routines: "/library/routines",
  newRoutine: "/library/routines/new",
  plugins: "/library/plugins",
  uploadPlugin: "/library/plugins/upload",
  addMcpServer: `/library/plugins?${LIBRARY_ADD_PARAM}=${LIBRARY_ADD_MCP_SERVER}`,
  environments: "/library/environments",
  newEnvironment: "/library/environments/new",
  files: "/library/files",
  marketplace: "/marketplace",
} as const;
