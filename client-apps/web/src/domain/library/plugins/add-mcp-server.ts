/**
 * The one spelling of the link that opens the Plugins list with the "Add
 * MCP server" form open: the Library's Add menu links here, and the list
 * page reads the parameter back. An MCP server lives in a plugin, so
 * adding one is adding a plugin of one server.
 */

/** The query parameter, and its value, that open the form on arrival. */
export const ADD_PARAM = "add";
export const ADD_MCP_SERVER = "mcp-server";

/** The Plugins list with the "Add MCP server" form open. */
export const ADD_MCP_SERVER_HREF = `/library/plugins?${ADD_PARAM}=${ADD_MCP_SERVER}`;
