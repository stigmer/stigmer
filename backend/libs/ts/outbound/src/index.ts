/**
 * `@stigmer/outbound`: the rules a Stigmer process dials a user-supplied
 * endpoint by. Two entry points, also reachable as subpaths:
 * `./egress` (the address policy, its check, the guarded fetch) and
 * `./mcp-oauth` (reading an MCP endpoint's authentication and finding its
 * login server). Consumers: the control plane, the runner, the catalogue
 * audit. The README says why one library and not three copies.
 */
export * from "./egress/index.js";
export * from "./mcp-oauth/index.js";
