/**
 * Providers for the Connect Tools overview tour.
 *
 * The plugin page and the launcher's composer read the plugin and the
 * person's My vault; the router answers both with tour-constant data: the
 * plugin as installed, and a My vault that already holds its server's login
 * (this overview is the outcome; the sign-in is `mcp-server-connect-tour`).
 * The approval-story runs arrive through `SessionView`'s `execution` prop,
 * and the widget rail renders purely from them (the fixture-determinism
 * rule, demos/README.md: fixtures only for tour-constant data, props for
 * anything that changes per step).
 *
 * The page's remaining lookups (its versions, the access check) fall
 * through to the router's built-in `unimplemented` response, which the SDK
 * hooks degrade from gracefully.
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
    getMine: () => buildMyVault(true),
  });
});
