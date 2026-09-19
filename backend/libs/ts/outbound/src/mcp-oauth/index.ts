/**
 * `@stigmer/outbound/mcp-oauth`: how an MCP endpoint's authentication is
 * read without a credential (the challenge rule, the complete `initialize`,
 * the one-request probe) and how its login server is found (the RFC 9728,
 * RFC 8414 and OpenID walk). See each module's header.
 */
export { isOAuthChallenge, parseResourceMetadataUrl } from "./challenge.js";
export {
  authorizationServerMetadataUrls,
  protectedResourceMetadataUrls,
  readAuthorizationServerMetadata,
  resolveAuthorizationServers,
  type AuthorizationServerMetadata,
  type MetadataAttempt,
  type MetadataRead,
  type MetadataReadDeps,
} from "./metadata.js";
export { probeEndpointAuth, type EndpointAuthOutcome, type EndpointProbeDeps } from "./probe.js";
export {
  initializeRequest,
  MCP_PROTOCOL_VERSION,
  MCP_SESSION_HEADER,
  toolsListRequest,
  type JsonRpcRequestInit,
} from "./request.js";
