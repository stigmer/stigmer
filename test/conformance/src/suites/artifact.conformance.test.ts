// Artifact conformance — content-addressed create, the read surfaces, the
// soft-delete lifecycle, and the local file-server disposition lane
// (Class A).
// Domain: conformance suites.
//
// Artifact is the execution-output store: a metadata resource plus a blob
// keyed by its SHA-256. Create is a direct handler taking spec + content
// bytes — it derives org from the producing execution best-effort and never
// checks the execution exists, which is what makes the domain standalone-
// testable on a bare server. The distinct surfaces asserted here:
//
//   - CONTENT ADDRESSING: status.content_hash is the content's SHA-256,
//     size_bytes the byte count, storage_state stored.
//   - TTL: expires_at defaults to ~30 days out; retention.ttl_days = -1
//     means permanent (expires_at empty).
//   - SOFT DELETE: delete is a storage_state transition, never a row
//     removal — get still resolves the metadata (the audit trail), while
//     getDownloadUrl/getContent refuse FailedPrecondition on the deleted
//     blob.
//   - The OVERSIZE boundary (disposition S1, AMENDED during execution and
//     recorded in the sub-project's wrong-assumptions): NEITHER cap is
//     cleanly black-box-assertable. The domain's 50MB check sits behind the
//     transport's 10MB message cap, and an over-cap send from the reference
//     TS client does not surface a graceful ResourceExhausted — the server
//     answers with a connection-level HTTP/2 ENHANCE_YOUR_CALM that poisons
//     the shared channel for unrelated RPCs. That is an HTTP/2 artifact,
//     not a wire contract, so the suite deliberately asserts NO oversize
//     arm; both caps stay unit-level in each edition (the #13 port carries
//     them as unit tests).
//   - getDownloadUrl reports ttl_seconds 604800 unconditionally (ratified
//     P3): local URLs never actually expire — pinned as the wire contract,
//     with the semantic mismatch disclosed in the wave-2 PR.
//   - The FILE-SERVER lane (local artifact storage only): the download URL
//     serves the bytes inline; appending ?download=<name> adds the
//     attachment Content-Disposition. Runs only where the target exposes
//     the lane (artifactHttpBaseUrl — absent on cloud, whose artifact bytes
//     travel authenticated presigned routes instead).
import { createHash } from "node:crypto";
import { Code } from "@connectrpc/connect";
import { ArtifactStorageState } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/enum_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { ARTIFACT_DEFAULT_CONTENT, makeArtifactInput } from "../support/artifacts";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterAll(async () => {
  await target?.teardown();
});

// No FixtureTracker here: artifact delete is a soft state transition (a
// behavior this suite pins), so "cleanup" would only flip states. Rows live
// in the per-file server's throwaway state dir and vanish at teardown.

// Most of this suite runs on the single-user targets only (a verified
// edition split, disclosed in the wave-2 PR): OSS derives the artifact's
// org from its source execution BEST-EFFORT — fabricated ids are accepted
// and fall back to an empty org, which is what makes the domain
// standalone-testable — while the multi-tenant edition REQUIRES the source
// execution to exist and carry an org (FailedPrecondition otherwise: an
// org-less artifact would be unownable where orgs are real). Cloud-side
// artifact behavior is covered by its integration tests against real runs.
function requiresSingleUserArtifacts(ctx: { skip: () => void }): boolean {
  if (target.capabilities.multiTenant) {
    ctx.skip();
    return true;
  }
  return false;
}

describe("Artifact conformance — create & content addressing", () => {
  it("create assigns an art_ id and stamps the content-addressed status", async (ctx) => {
    if (requiresSingleUserArtifacts(ctx)) return;
    const created = await clients.artifactCommand.create(makeArtifactInput());

    expect(created.metadata?.id).toMatch(/^art_/);
    expect(created.metadata?.name).toBe("conformance-artifact.txt");
    expect(created.status?.contentHash).toBe(
      createHash("sha256").update(ARTIFACT_DEFAULT_CONTENT).digest("hex"),
    );
    expect(created.status?.sizeBytes).toBe(BigInt(ARTIFACT_DEFAULT_CONTENT.byteLength));
    expect(created.status?.storageState).toBe(ArtifactStorageState.storage_state_stored);
  });

  it("expires_at defaults to ~30 days out; ttl_days -1 means permanent", async (ctx) => {
    if (requiresSingleUserArtifacts(ctx)) return;
    const defaulted = await clients.artifactCommand.create(makeArtifactInput());
    const expiresAt = Date.parse(defaulted.status?.expiresAt ?? "");
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(expiresAt - Date.now()).toBeGreaterThan(thirtyDaysMs - 60_000);
    expect(expiresAt - Date.now()).toBeLessThan(thirtyDaysMs + 60_000);

    const permanent = await clients.artifactCommand.create(makeArtifactInput({ ttlDays: -1 }));
    expect(permanent.status?.expiresAt, "-1 is the never-expires marker").toBe("");
  });

  it("accepts a fabricated execution id and falls back to an empty org (the OSS posture)", async (ctx) => {
    if (requiresSingleUserArtifacts(ctx)) return;
    // Org derivation is best-effort by design: the create path must not
    // fail an artifact write because its producing execution is unknown.
    const created = await clients.artifactCommand.create(
      makeArtifactInput({ agentExecutionId: "aexec_01neverexisted" }),
    );
    expect(created.metadata?.org).toBe("");
  });

  it("rejects a create with empty content (InvalidArgument, both editions)", async () => {
    // Code only, never copy: the arm fires in the proto validation layer
    // (buf.validate) BEFORE the handler's own check, so the handler's
    // message is unreachable from the wire.
    await expectGrpcCode(
      () => clients.artifactCommand.create(makeArtifactInput({ content: new Uint8Array(0) })),
      Code.InvalidArgument,
      "create with empty content",
    );
  });

  it("rejects a create without an execution source (InvalidArgument — single-user posture)", async (ctx) => {
    // Edition split, disclosed in the wave-2 PR: the multi-tenant edition
    // resolves the source BEFORE the emptiness check and answers
    // FailedPrecondition ("source execution not found or carries no org"),
    // so only the single-user InvalidArgument arm is pinned here.
    if (requiresSingleUserArtifacts(ctx)) return;
    const input = makeArtifactInput();
    (input.spec as { source?: unknown }).source = {};
    await expectGrpcCode(
      () => clients.artifactCommand.create(input),
      Code.InvalidArgument,
      "create without an execution source",
    );
  });
});

describe("Artifact conformance — read surfaces", () => {
  it("get and listByExecution resolve the artifact by id and by source", async (ctx) => {
    if (requiresSingleUserArtifacts(ctx)) return;
    const executionId = `wexec_01${uniqueName("run").replace(/-/g, "")}`.slice(0, 30);
    const created = await clients.artifactCommand.create(
      makeArtifactInput({ workflowExecutionId: executionId }),
    );

    const fetched = await clients.artifactQuery.get({ value: created.metadata!.id });
    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    expect(fetched.status?.contentHash).toBe(created.status?.contentHash);

    const listed = await clients.artifactQuery.listByExecution({
      workflowExecutionId: executionId,
    });
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]?.metadata?.id).toBe(created.metadata?.id);

    // The other source arm does not match.
    const other = await clients.artifactQuery.listByExecution({
      agentExecutionId: executionId,
    });
    expect(other.entries).toHaveLength(0);
  });

  it("listByExecution requires an execution filter (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.artifactQuery.listByExecution({}),
      Code.InvalidArgument,
      "listByExecution without any filter",
    );
  });

  it("getContent returns the bytes, truncating to max_bytes with the full size reported", async (ctx) => {
    if (requiresSingleUserArtifacts(ctx)) return;
    const content = new TextEncoder().encode("0123456789".repeat(100)); // 1000 bytes
    const created = await clients.artifactCommand.create(makeArtifactInput({ content }));

    const full = await clients.artifactQuery.getContent({
      artifactId: created.metadata!.id,
    });
    expect(full.truncated).toBe(false);
    expect(full.totalSizeBytes).toBe(1000n);
    expect(full.contentType).toBe("text/plain");
    expect(new Uint8Array(full.content)).toEqual(content);

    const truncated = await clients.artifactQuery.getContent({
      artifactId: created.metadata!.id,
      maxBytes: 100n,
    });
    expect(truncated.truncated).toBe(true);
    expect(truncated.totalSizeBytes, "total size reports the FULL blob").toBe(1000n);
    expect(truncated.content).toHaveLength(100);
  });

  it("getDownloadUrl answers the pinned ttl_seconds constant and the blob facts (P3)", async (ctx) => {
    if (requiresSingleUserArtifacts(ctx)) return;
    const created = await clients.artifactCommand.create(makeArtifactInput());

    const download = await clients.artifactQuery.getDownloadUrl({
      value: created.metadata!.id,
    });
    expect(download.url).toContain(created.status!.contentHash);
    // 7 days in seconds, reported unconditionally — local URLs never
    // actually expire (the disclosed P3 semantic mismatch).
    expect(download.ttlSeconds).toBe(604800);
    expect(download.sizeBytes).toBe(created.status?.sizeBytes);
    expect(download.contentType).toBe("text/plain");
  });

  it("unknown ids answer NotFound across the read surfaces", async (ctx) => {
    if (requiresSingleUserArtifacts(ctx)) return;
    const get = await expectGrpcCode(
      () => clients.artifactQuery.get({ value: "art_01conformancemissing" }),
      Code.NotFound,
      "get missing artifact",
    );
    expect(get.rawMessage).toBe("Artifact not found: art_01conformancemissing");

    await expectGrpcCode(
      () => clients.artifactQuery.getDownloadUrl({ value: "art_01conformancemissing" }),
      Code.NotFound,
      "getDownloadUrl missing artifact",
    );
    await expectGrpcCode(
      () => clients.artifactQuery.getContent({ artifactId: "art_01conformancemissing" }),
      Code.NotFound,
      "getContent missing artifact",
    );
  });
});

describe("Artifact conformance — the soft-delete lifecycle", () => {
  it("delete transitions storage_state; metadata survives; blob reads refuse FailedPrecondition", async (ctx) => {
    if (requiresSingleUserArtifacts(ctx)) return;
    const created = await clients.artifactCommand.create(makeArtifactInput());

    const deleted = await clients.artifactCommand.delete({ value: created.metadata!.id });
    expect(deleted.status?.storageState).toBe(ArtifactStorageState.storage_state_deleted);

    // Soft delete: the metadata row remains readable — the audit trail of
    // what an execution produced outlives the blob.
    const fetched = await clients.artifactQuery.get({ value: created.metadata!.id });
    expect(fetched.status?.storageState).toBe(ArtifactStorageState.storage_state_deleted);

    // The blob lanes fail closed on the deleted state.
    const download = await expectGrpcCode(
      () => clients.artifactQuery.getDownloadUrl({ value: created.metadata!.id }),
      Code.FailedPrecondition,
      "getDownloadUrl after delete",
    );
    expect(download.rawMessage).toBe(
      `artifact blob has been deleted: ${created.metadata!.id}`,
    );
    await expectGrpcCode(
      () => clients.artifactQuery.getContent({ artifactId: created.metadata!.id }),
      Code.FailedPrecondition,
      "getContent after delete",
    );
  });
});

describe("Artifact conformance — the local file-server lane", () => {
  it("serves the blob inline, and ?download=<name> adds the attachment disposition", async (ctx) => {
    // Only local artifact storage has this lane; cloud serves artifact
    // bytes through authenticated presigned routes (a different contract),
    // so the accessor is absent there and this reports SKIPPED.
    if (target.artifactHttpBaseUrl === undefined) return ctx.skip();
    const content = new TextEncoder().encode("file-server conformance body\n");
    const created = await clients.artifactCommand.create(makeArtifactInput({ content }));

    const download = await clients.artifactQuery.getDownloadUrl({
      value: created.metadata!.id,
    });

    // Inline serve: the URL getDownloadUrl mints (no download param — the
    // inline disposition is this RPC's documented behavior).
    const inline = await fetch(download.url);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-disposition")).toBeNull();
    expect(new Uint8Array(await inline.arrayBuffer())).toEqual(content);

    // Attachment disposition: the ?download= query the file server reads,
    // mirroring the R2 backend's signed disposition.
    const attachment = await fetch(`${download.url}?download=report.txt`);
    expect(attachment.status).toBe(200);
    expect(attachment.headers.get("content-disposition")).toBe(
      'attachment; filename="report.txt"',
    );
  });
});
