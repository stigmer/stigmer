// Wire-shape tests for RoutedSkillClient's size-routed push (stigmer#701).
// A router transport fakes the skill service in-process, so the routing is
// exercised through the REAL generated client and its error wrapping — the
// CLI's earlier copy of this logic keyed its fallback on `instanceof
// ConnectError`, which the SDK's wrapError made unreachable; these pins run
// the wrapped path. Mirrors sdk/go/skill_test.go's five routing pins.
import { describe, expect, it, vi } from "vitest";
import { Code, ConnectError, createRouterTransport, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import {
  PushSkillRequestSchema,
  SkillArtifactUploadUrlSchema,
  type PushSkillRequest,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { StigmerError } from "../gen/errors.js";
import { MAX_INLINE_ARTIFACT_BYTES, RoutedSkillClient } from "../skill.js";

const STAGING_URL = "http://stage.example/v1/skill-artifacts/uploads/sau_t";

interface Captured {
  pushes: PushSkillRequest[];
  mints: number;
}

/**
 * In-process skill service. `withMint: false` leaves createArtifactUploadUrl
 * unregistered, so the router answers Unimplemented — the exact wire shape
 * of a pre-transfer-lane server.
 */
function fakeTransport(captured: Captured, opts: { withMint: boolean } = { withMint: true }): Transport {
  return createRouterTransport(({ service }) => {
    service(SkillCommandController, {
      push: (req) => {
        captured.pushes.push(req);
        return create(SkillSchema, {});
      },
      ...(opts.withMint
        ? {
            createArtifactUploadUrl: (req) => {
              captured.mints++;
              expect(req.sizeBytes).toBeGreaterThan(0n);
              return create(SkillArtifactUploadUrlSchema, {
                url: STAGING_URL,
                artifactUploadRef: "sau_t",
                ttlSeconds: 900,
              });
            },
          }
        : {}),
    });
  });
}

function okFetch(record: { putUrl?: string; putBytes?: number; contentType?: string }) {
  return vi.fn(async (url: any, init: any) => {
    record.putUrl = String(url);
    record.putBytes = init.body instanceof Uint8Array ? init.body.byteLength : -1;
    record.contentType = init.headers["content-type"];
    return new Response(null, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
}

describe("RoutedSkillClient.push size routing", () => {
  it("keeps small artifacts inline — no mint, bytes in the request", async () => {
    const captured: Captured = { pushes: [], mints: 0 };
    const client = new RoutedSkillClient(fakeTransport(captured));

    await client.push(create(PushSkillRequestSchema, { org: "acme", artifact: new Uint8Array(1024) }));

    expect(captured.mints).toBe(0);
    expect(captured.pushes).toHaveLength(1);
    expect(captured.pushes[0].artifact.length).toBe(1024);
  });

  it("stages large artifacts over HTTP and pushes by reference, preserving the envelope", async () => {
    const captured: Captured = { pushes: [], mints: 0 };
    const record: { putUrl?: string; putBytes?: number; contentType?: string } = {};
    const client = new RoutedSkillClient(fakeTransport(captured), okFetch(record));
    const artifact = new Uint8Array(MAX_INLINE_ARTIFACT_BYTES + 1);

    await client.push(create(PushSkillRequestSchema, { org: "acme", artifact, tag: "stable", message: "big" }));

    expect(captured.mints).toBe(1);
    expect(record.putUrl).toBe(STAGING_URL);
    expect(record.putBytes).toBe(artifact.length);
    expect(record.contentType).toBe("application/zip");
    expect(captured.pushes).toHaveLength(1);
    expect(captured.pushes[0].artifact.length).toBe(0);
    expect(captured.pushes[0].artifactUploadRef).toBe("sau_t");
    // The by-ref rewrite must not lose the rest of the request.
    expect(captured.pushes[0].tag).toBe("stable");
    expect(captured.pushes[0].message).toBe("big");
  });

  it("passes an explicit upload ref through untouched — the caller staged it", async () => {
    const captured: Captured = { pushes: [], mints: 0 };
    const client = new RoutedSkillClient(fakeTransport(captured));

    await client.push(create(PushSkillRequestSchema, { org: "acme", artifactUploadRef: "sau_mine" }));

    expect(captured.mints).toBe(0);
    expect(captured.pushes).toHaveLength(1);
    expect(captured.pushes[0].artifactUploadRef).toBe("sau_mine");
  });

  it("fails loud against servers that predate the transfer lane (wrapped Unimplemented)", async () => {
    const captured: Captured = { pushes: [], mints: 0 };
    const client = new RoutedSkillClient(fakeTransport(captured, { withMint: false }));

    await expect(
      client.push(create(PushSkillRequestSchema, { org: "acme", artifact: new Uint8Array(MAX_INLINE_ARTIFACT_BYTES + 1) })),
    ).rejects.toThrow(/upgrade stigmer-server/);
    expect(captured.pushes).toHaveLength(0);
  });

  it("surfaces the staging rejection body and never proceeds to push", async () => {
    const captured: Captured = { pushes: [], mints: 0 };
    const rejectingFetch = (async () =>
      new Response("staging slot expired", { status: 404 })) as unknown as typeof globalThis.fetch;
    const client = new RoutedSkillClient(fakeTransport(captured), rejectingFetch);

    await expect(
      client.push(create(PushSkillRequestSchema, { org: "acme", artifact: new Uint8Array(MAX_INLINE_ARTIFACT_BYTES + 1) })),
    ).rejects.toThrow(/HTTP 404: staging slot expired/);
    expect(captured.pushes).toHaveLength(0);
  });

  it("propagates non-Unimplemented mint errors unmasked", async () => {
    const captured: Captured = { pushes: [], mints: 0 };
    const transport = createRouterTransport(({ service }) => {
      service(SkillCommandController, {
        push: (req) => {
          captured.pushes.push(req);
          return create(SkillSchema, {});
        },
        createArtifactUploadUrl: () => {
          throw new ConnectError("artifact too large", Code.InvalidArgument);
        },
      });
    });
    const client = new RoutedSkillClient(transport);

    await expect(
      client.push(create(PushSkillRequestSchema, { org: "acme", artifact: new Uint8Array(MAX_INLINE_ARTIFACT_BYTES + 1) })),
    ).rejects.toSatisfy((err: unknown) => err instanceof StigmerError && err.code === "invalid-argument");
    expect(captured.pushes).toHaveLength(0);
  });
});
