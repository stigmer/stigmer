/**
 * Data fixtures for skill-detail-tour. `scenar pack` and `scenar render` wrap
 * every step of this tour in the exported `PreviewProviders`.
 *
 * The only RPC the tour's real component calls is
 * `SkillQueryController.getByReference` (via `SkillDetailView`). Everything
 * else the SDK might request falls through to the router's `unimplemented`
 * response, which the hooks degrade from — so we mock just this one.
 */
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { createStigmerPreview } from "../../_shared/stigmer-preview";
import { buildDemoSkill } from "../steps";

export const PreviewProviders = createStigmerPreview((router) => {
  router.service(SkillQueryController, {
    getByReference: () => buildDemoSkill(),
  });
});
