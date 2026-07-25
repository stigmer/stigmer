/**
 * Data fixtures for skill-creation-tour. `scenar pack` and `scenar render`
 * wrap every step of this tour in the exported `PreviewProviders`.
 *
 * The only RPC the tour's real components call is
 * `SkillQueryController.getByReference` — `SkillDetailView` fetches the skill
 * on mount. The fixture carries its content inline as `spec.skillMd`, so no
 * artifact fetch follows. `SkillUploader` makes no RPCs until a file is
 * actually dropped (never happens in a playback), and unregistered RPCs
 * (e.g. `listVersions`) fall through to the router's `unimplemented`
 * response, which the SDK hooks degrade from.
 */
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { createStigmerPreview } from "../../_shared/stigmer-preview";
import { buildDemoSkill } from "../steps";

export const PreviewProviders = createStigmerPreview((router) => {
  router.service(SkillQueryController, {
    getByReference: () => buildDemoSkill(),
  });
});
