// Wire-shape tests for RoutedPluginClient's size-routed push: the plugin
// binding of the shared artifact routing. The routing mechanism itself is
// pinned by skill.test.ts; these arms pin that the plugin binding reads
// and rewrites ITS request shape (org, artifact, artifactUploadRef,
// visibility, message) and mints through ITS createArtifactUploadUrl.
import { describe, expect, it, vi } from "vitest";
import { createRouterTransport, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  PluginArtifactUploadUrlSchema,
  PushPluginRequestSchema,
  type PushPluginRequest,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { RoutedPluginClient } from "../plugin.js";
import { MAX_INLINE_ARTIFACT_BYTES } from "../skill.js";

const STAGING_URL = "http://stage.example/v1/skill-artifacts/uploads/sau_p";

interface Captured {
  pushes: PushPluginRequest[];
  mints: number;
}

function fakeTransport(captured: Captured): Transport {
  return createRouterTransport(({ service }) => {
    service(PluginCommandController, {
      push: (req) => {
        captured.pushes.push(req);
        return create(PluginSchema, {});
      },
      createArtifactUploadUrl: (req) => {
        captured.mints++;
        expect(req.org).toBe("acme");
        expect(req.sizeBytes).toBeGreaterThan(0n);
        return create(PluginArtifactUploadUrlSchema, {
          url: STAGING_URL,
          artifactUploadRef: "sau_p",
          ttlSeconds: 900,
        });
      },
    });
  });
}

describe("RoutedPluginClient.push size routing", () => {
  it("keeps a small archive inline", async () => {
    const captured: Captured = { pushes: [], mints: 0 };
    const client = new RoutedPluginClient(fakeTransport(captured));
    await client.push(
      create(PushPluginRequestSchema, {
        org: "acme",
        artifact: new Uint8Array(2048),
      }),
    );
    expect(captured.mints).toBe(0);
    expect(captured.pushes[0]?.artifact.length).toBe(2048);
  });

  it("stages a large archive through the plugin's own mint and pushes by reference, keeping the envelope", async () => {
    const captured: Captured = { pushes: [], mints: 0 };
    const record: { url?: string; bytes?: number } = {};
    const fetchImpl = vi.fn(async (url: unknown, init: RequestInit) => {
      record.url = String(url);
      record.bytes =
        init.body instanceof Uint8Array ? init.body.byteLength : -1;
      return new Response(null, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const client = new RoutedPluginClient(fakeTransport(captured), fetchImpl);
    const artifact = new Uint8Array(MAX_INLINE_ARTIFACT_BYTES + 1);

    await client.push(
      create(PushPluginRequestSchema, {
        org: "acme",
        artifact,
        visibility: ApiResourceVisibility.visibility_org,
        message: "big",
      }),
    );

    expect(captured.mints).toBe(1);
    expect(record.url).toBe(STAGING_URL);
    expect(record.bytes).toBe(artifact.length);
    const pushed = captured.pushes[0]!;
    expect(pushed.artifact.length).toBe(0);
    expect(pushed.artifactUploadRef).toBe("sau_p");
    expect(pushed.visibility).toBe(ApiResourceVisibility.visibility_org);
    expect(pushed.message).toBe("big");
  });
});
