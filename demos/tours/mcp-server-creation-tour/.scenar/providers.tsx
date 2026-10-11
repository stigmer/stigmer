/**
 * Providers for the Add MCP server tour.
 *
 * The list and form beats are prop-driven (fixture rows, the form replica's
 * phase). The closing beats render the real plugin page, which reads the
 * plugin and the person's My vault: the router answers both, with the
 * plugin as "Add MCP server" installed it and a vault that holds no login
 * yet, so the server reads "Not signed in" (the sign-in is the next tour).
 * Everything else the page asks (its versions, the access check) falls
 * through to the router's `unimplemented` response, which the SDK hooks
 * degrade from gracefully.
 */
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { buildMyVault, buildOrderMgmtPlugin } from "../../_shared/order-management-plugin";
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview((router) => {
  router.service(PluginQueryController, {
    getByReference: () => buildOrderMgmtPlugin(),
  });
  router.service(VaultQueryController, {
    getMine: () => buildMyVault(false),
  });
});
