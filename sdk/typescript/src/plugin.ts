import { create } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  CreatePluginArtifactUploadUrlRequestSchema,
  PushPluginRequestSchema,
  type PushPluginRequest,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { pushRoutedArtifact } from "./artifact-routing.js";
import type { ArtifactRoute } from "./artifact-routing.js";
import { PluginClient } from "./gen/plugin.js";

/**
 * Plugin client with transport-aware push routing: the plugin binding of
 * `artifact-routing.ts`. A plugin archive travels inline when it fits the
 * gRPC message cap and is staged over HTTP via `createArtifactUploadUrl`
 * (the skill lane's slots, one upload surface) when it does not; `push`
 * simply works for any valid archive size. Every other method is the
 * generated client's, inherited unchanged.
 */
export class RoutedPluginClient extends PluginClient {
  private readonly fetchImpl: typeof globalThis.fetch | undefined;
  private readonly route: ArtifactRoute<PushPluginRequest, Plugin>;

  /**
   * @param fetchImpl - Custom `fetch` for the staging PUT. Must be the same
   *   implementation the transport uses where the global one is restricted
   *   (the Tauri CSP/CORS case the `Stigmer.fetch` property documents).
   */
  constructor(transport: Transport, fetchImpl?: typeof globalThis.fetch) {
    super(transport);
    this.fetchImpl = fetchImpl;
    this.route = {
      noun: "plugin",
      artifactOf: (request) => request.artifact,
      uploadRefOf: (request) => request.artifactUploadRef,
      orgOf: (request) => request.org,
      withUploadRef: (request, artifactUploadRef) =>
        create(PushPluginRequestSchema, {
          ...request,
          artifact: new Uint8Array(0),
          artifactUploadRef,
        }),
      mintUploadUrl: (org, sizeBytes) =>
        super.createArtifactUploadUrl(
          create(CreatePluginArtifactUploadUrlRequestSchema, {
            org,
            sizeBytes,
          }),
        ),
      push: (request) => super.push(request),
    };
  }

  /** Push a plugin archive, routing it by size (see the class comment). */
  override push(input: PushPluginRequest): Promise<Plugin> {
    return pushRoutedArtifact(this.route, input, this.fetchImpl);
  }
}
