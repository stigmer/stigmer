/**
 * Data fixtures for agent-creation-tour. `scenar pack` and `scenar render`
 * wrap every step of this tour in the exported `PreviewProviders`.
 *
 * The only RPC the tour's real components call is
 * `AgentExecutionQueryController.getArtifactContent` — `ArtifactPreviewContent`
 * fetches the artifact body on mount (its download hook is lazy and its Apply
 * CTA is only pointed at, never clicked). Everything else renders from props,
 * so we mock just this one; unregistered RPCs fall through to the router's
 * `unimplemented` response, which the SDK hooks degrade from.
 */
import { create } from "@bufbuild/protobuf";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { GetArtifactContentResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { createStigmerPreview } from "../../_shared/stigmer-preview";
import { AGENT_YAML } from "../steps";

const yamlBytes = new TextEncoder().encode(AGENT_YAML);

export const PreviewProviders = createStigmerPreview((router) => {
  router.service(AgentExecutionQueryController, {
    getArtifactContent: () =>
      create(GetArtifactContentResponseSchema, {
        content: yamlBytes,
        contentType: "text/yaml",
        totalSizeBytes: BigInt(yamlBytes.length),
        truncated: false,
      }),
  });
});
