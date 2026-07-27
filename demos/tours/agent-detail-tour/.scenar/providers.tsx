/**
 * Data fixtures for agent-detail-tour. `scenar pack` and `scenar render` wrap
 * every step of this tour in the exported `PreviewProviders`.
 *
 * The only RPC the tour's real component calls is
 * `AgentQueryController.getByReference` (via `AgentDetailView`). Everything
 * else the SDK might request falls through to the router's `unimplemented`
 * response, which the hooks degrade from — so we mock just this one.
 */
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { createStigmerPreview } from "../../_shared/stigmer-preview";
import { buildDemoAgent } from "../steps";

export const PreviewProviders = createStigmerPreview((router) => {
  router.service(AgentQueryController, {
    getByReference: () => buildDemoAgent(),
  });
});
