// Wire-shape tests for the eval's SDK surface. RoutedEvalClient's push is
// the eval binding of the shared artifact routing (pinned by skill.test.ts):
// these arms pin that a large archive is staged through the eval's own
// mint, which names the push's slug, and pushed by reference with its
// envelope kept. downloadEvalArchive prefers the URL lane, reads inline on a
// server without it, refuses a URL that answers an HTTP error, and refuses
// bytes that do not match the digest.
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { Code, ConnectError, createRouterTransport, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { EvalSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import { EvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/command_pb";
import { EvalQueryController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/query_pb";
import {
  EvalArchiveDownloadUrlSchema,
  EvalArchiveSchema,
  EvalArtifactUploadUrlSchema,
  PushEvalRequestSchema,
  type CreateEvalArtifactUploadUrlRequest,
  type PushEvalRequest,
} from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import { RoutedEvalClient, downloadEvalArchive } from "../eval.js";
import { EvalClient } from "../gen/eval.js";
import { MAX_INLINE_ARTIFACT_BYTES } from "../skill.js";

const STAGING_URL = "http://stage.example/v1/skill-artifacts/uploads/sau_e";
const DOWNLOAD_URL = "http://stage.example/v1/skill-artifacts/evals/x.zip";

interface Captured {
  pushes: PushEvalRequest[];
  mints: CreateEvalArtifactUploadUrlRequest[];
}

function pushTransport(captured: Captured): Transport {
  return createRouterTransport(({ service }) => {
    service(EvalCommandController, {
      push: (req) => {
        captured.pushes.push(req);
        return create(EvalSchema, {});
      },
      createArtifactUploadUrl: (req) => {
        captured.mints.push(req);
        return create(EvalArtifactUploadUrlSchema, { url: STAGING_URL, artifactUploadRef: "sau_e", ttlSeconds: 900 });
      },
    });
  });
}

describe("RoutedEvalClient.push size routing", () => {
  it("keeps a small archive inline", async () => {
    const captured: Captured = { pushes: [], mints: [] };
    await new RoutedEvalClient(pushTransport(captured)).push(
      create(PushEvalRequestSchema, { org: "acme", slug: "support", artifact: new Uint8Array(2048) }),
    );
    expect(captured.mints).toEqual([]);
    expect(captured.pushes[0]?.artifact.length).toBe(2048);
  });

  it("stages a large archive through a mint that names the slug, and pushes by reference keeping the envelope", async () => {
    const captured: Captured = { pushes: [], mints: [] };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch;
    const artifact = new Uint8Array(MAX_INLINE_ARTIFACT_BYTES + 1);
    await new RoutedEvalClient(pushTransport(captured), fetchImpl).push(
      create(PushEvalRequestSchema, { org: "acme", slug: "support", artifact, tag: "stable", message: "big" }),
    );
    expect(captured.mints.map((m) => [m.org, m.slug, m.sizeBytes])).toEqual([["acme", "support", BigInt(artifact.length)]]);
    const pushed = captured.pushes[0]!;
    expect(pushed.artifact.length).toBe(0);
    expect(pushed.artifactUploadRef).toBe("sau_e");
    expect([pushed.slug, pushed.tag, pushed.message]).toEqual(["support", "stable", "big"]);
  });
});

const encoder = new TextEncoder();
const ARCHIVE = encoder.encode("PK zipped cases");
const DIGEST = createHash("sha256").update(ARCHIVE).digest("hex");
const REF = { org: "acme", slug: "support", version: "stable" };

function queryClient(handlers: {
  getDownloadUrl?: () => unknown;
  download?: () => unknown;
}): EvalClient {
  return new EvalClient(
    createRouterTransport(({ service }) => {
      service(EvalQueryController, {
        getDownloadUrl: () => {
          if (handlers.getDownloadUrl === undefined) throw new ConnectError("no lane", Code.Unimplemented);
          return handlers.getDownloadUrl() as never;
        },
        download: () => {
          if (handlers.download === undefined) throw new ConnectError("no inline read", Code.Unimplemented);
          return handlers.download() as never;
        },
      });
    }),
  );
}

describe("downloadEvalArchive", () => {
  it("fetches the URL the server mints and returns the bytes with their digest", async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      expect(String(url)).toBe(DOWNLOAD_URL);
      return new Response(ARCHIVE, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const client = queryClient({
      getDownloadUrl: () => create(EvalArchiveDownloadUrlSchema, { url: DOWNLOAD_URL, digest: DIGEST, sizeBytes: BigInt(ARCHIVE.length) }),
    });
    const got = await downloadEvalArchive(client, REF, fetchImpl);
    expect(got.digest).toBe(DIGEST);
    expect(got.bytes).toEqual(ARCHIVE);
  });

  it.each([
    ["Expired link", "eval archive download failed with HTTP 403: Expired link"],
    ["", "eval archive download failed with HTTP 403"],
  ])("refuses a URL that answers an HTTP error, quoting its body %j", async (body, message) => {
    const fetchImpl = vi.fn(async () => new Response(body, { status: 403 })) as unknown as typeof globalThis.fetch;
    const client = queryClient({
      getDownloadUrl: () => create(EvalArchiveDownloadUrlSchema, { url: DOWNLOAD_URL, digest: DIGEST, sizeBytes: BigInt(ARCHIVE.length) }),
    });
    await expect(downloadEvalArchive(client, REF, fetchImpl)).rejects.toThrow(message);
  });

  it("refuses a URL whose error body cannot be read, with the status alone", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    const fetchImpl = vi.fn(async () => new Response(broken, { status: 502 })) as unknown as typeof globalThis.fetch;
    const client = queryClient({
      getDownloadUrl: () => create(EvalArchiveDownloadUrlSchema, { url: DOWNLOAD_URL, digest: DIGEST, sizeBytes: BigInt(ARCHIVE.length) }),
    });
    await expect(downloadEvalArchive(client, REF, fetchImpl)).rejects.toThrow(/^eval archive download failed with HTTP 502$/);
  });

  it("reads inline from a server without the URL lane", async () => {
    const client = queryClient({ download: () => create(EvalArchiveSchema, { artifact: ARCHIVE, digest: DIGEST }) });
    const got = await downloadEvalArchive(client, REF);
    expect(got.bytes).toEqual(ARCHIVE);
  });

  it("refuses bytes that do not match the digest", async () => {
    const client = queryClient({ download: () => create(EvalArchiveSchema, { artifact: encoder.encode("tampered"), digest: DIGEST }) });
    await expect(downloadEvalArchive(client, REF)).rejects.toThrow(/does not match its digest/);
  });

  it("passes a refusal other than a missing lane through", async () => {
    const client = queryClient({
      getDownloadUrl: () => {
        throw new ConnectError("unauthorized to get eval", Code.PermissionDenied);
      },
      download: () => create(EvalArchiveSchema, { artifact: ARCHIVE, digest: DIGEST }),
    });
    await expect(downloadEvalArchive(client, REF)).rejects.toThrow(/unauthorized to get eval/);
  });
});
