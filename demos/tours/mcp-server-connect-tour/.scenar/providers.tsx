/**
 * Providers for the sign-in and check-tools tour.
 *
 * The plugin page reads the plugin and the person's My vault. The plugin is
 * the same in every beat. My vault is the one thing the story changes, and
 * a beat names its side of the sign-in by how it names the organization
 * (`steps.ts`): asked by the organization's id, My vault holds the login at
 * the server's address; asked by its slug, it holds none. The answer is a
 * pure function of the request, so scrubbing and video export reproduce
 * every beat. Everything else the page asks (its versions, the access
 * check) falls through to the router's `unimplemented` response, which the
 * SDK hooks degrade from gracefully.
 */
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { DEMO_ORG_ID } from "../../_shared/fixtures";
import { buildMyVault, buildOrderMgmtPlugin } from "../../_shared/order-management-plugin";
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview((router) => {
  router.service(PluginQueryController, {
    getByReference: () => buildOrderMgmtPlugin(),
  });
  router.service(VaultQueryController, {
    getMine: (input) => buildMyVault(input.org === DEMO_ORG_ID),
  });
});
