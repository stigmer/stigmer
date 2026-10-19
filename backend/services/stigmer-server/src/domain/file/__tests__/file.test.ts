/**
 * Pins the File controller (../controller.ts) through the REAL stack:
 * composed servers on ephemeral ports, native gRPC clients, the full
 * interceptor chain, the local File store and its transfer lane on the
 * unified port, reached over HTTP exactly as a client reaches it.
 *
 * On a trusted-local server with a 64 KiB cap:
 *   - an inline upload mints a `file_` id, takes its type from the
 *     extension, stores its size, starts private, and its download link
 *     serves the bytes as a download named by the filename;
 *   - a staged upload (createUploadUrl, an HTTP PUT, upload by reference)
 *     yields the same File, and its reference is spent;
 *   - a PUT of another size than declared is refused by the lane, and an
 *     upload over the cap is refused at the URL and inline;
 *   - an upload into a conversation records it, lists under it, and is
 *     refused when the request names another organization;
 *   - deleting the conversation deletes its Files and their bytes;
 *   - update changes labels, refuses the filename by name, and keeps it
 *     under `*`;
 *   - delete removes the File and its bytes.
 *
 * Under the require-authentication posture (the built-in evaluator over
 * the compiled model), with Carol, who founded the organization (an
 * admin), and Dave, a member:
 *   - Dave's own File is his alone: Carol, an admin, may not read it;
 *   - Dave may not upload into Carol's conversation (the open-source
 *     server grants no participants; the model's tests pin a participant's
 *     upload and the owner's delete), and he may neither read nor delete
 *     the File Carol uploads into it.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { FileSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/spec_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import { errorOf } from "../../../pipeline/__tests__/support.js";
import { organizationId, seedOrganizations } from "../../organization/__tests__/support.js";

const CAP = 64 * 1024;

/** The artifact root's blobs of an organization, as the local store keeps them. */
function blobsOnDisk(dir: string, org: string): string[] {
  try {
    return readdirSync(path.join(dir, "artifacts", "files", org));
  } catch {
    return [];
  }
}

function sessionInput(org: string, name: string) {
  return { apiVersion: "agentic.stigmer.ai/v1", kind: "Session", metadata: { name, org }, spec: {} };
}

describe("the File controller (trusted-local, composed server)", () => {
  const ORG = "files-acme";
  const OTHER_ORG = "files-globex";
  let dir: string;
  let server: ComposedServer;
  let orgId: string;
  let command: Client<typeof FileCommandController>;
  let query: Client<typeof FileQueryController>;
  let sessions: Client<typeof SessionCommandController>;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "file-domain-test-"));
    vi.stubEnv("STIGMER_ACTIVITY_ROUTING", "session");
    server = await composeServer({
      config: loadConfig({ ...baseConfig(dir), FILE_MAX_BYTES: String(CAP) }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const transport: Transport = transportFor(port);
    const organizations = await seedOrganizations(transport, [ORG, OTHER_ORG]);
    orgId = organizationId(organizations, ORG);
    command = createClient(FileCommandController, transport);
    query = createClient(FileQueryController, transport);
    sessions = createClient(SessionCommandController, transport);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("uploads inline: a file_ id, the extension's type, its size, private, and a link that downloads it by name", async () => {
    const file = await command.upload({
      org: ORG,
      filename: "Q3 ledger.csv",
      source: { case: "data", value: new TextEncoder().encode("a,b\n1,2\n") },
    });
    expect(file.metadata?.id).toMatch(/^file_[0-9a-z]{26}$/);
    expect(file.metadata?.org).toBe(orgId);
    expect(file.metadata?.name).toBe("Q3 ledger.csv");
    expect(file.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    expect(file.spec?.mimeType).toBe("text/csv");
    expect(file.status?.sizeBytes).toBe(8n);
    expect(file.status?.sessionId).toBe("");

    expect((await query.get({ value: file.metadata!.id })).spec?.filename).toBe("Q3 ledger.csv");
    const link = await query.getDownloadUrl({ value: file.metadata!.id });
    expect(link.expiresAt).toBeDefined();
    const response = await fetch(link.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="Q3 ledger.csv"');
    expect(await response.text()).toBe("a,b\n1,2\n");
  });

  it("uploads through an upload URL: the same File, and the reference spent", async () => {
    const bytes = new Uint8Array(20_000).fill(7);
    const url = await command.createUploadUrl({ org: ORG, sizeBytes: BigInt(bytes.length) });
    expect(url.uploadRef).toMatch(/^fup_[0-9a-f]{32}$/);
    const put = await fetch(url.url, { method: "PUT", body: bytes });
    expect(put.status).toBe(204);

    const file = await command.upload({
      org: ORG,
      filename: "big.bin",
      mimeType: "application/x-thing",
      source: { case: "uploadRef", value: url.uploadRef },
    });
    expect(file.status?.sizeBytes).toBe(20_000n);
    expect(file.spec?.mimeType).toBe("application/x-thing");
    const downloaded = new Uint8Array(await (await fetch((await query.getDownloadUrl({ value: file.metadata!.id })).url)).arrayBuffer());
    expect(downloaded).toEqual(bytes);

    const again = await errorOf(() =>
      command.upload({ org: ORG, filename: "big.bin", source: { case: "uploadRef", value: url.uploadRef } }),
    );
    expect(again.code).toBe(Code.FailedPrecondition);
  });

  it("refuses a PUT of another size than declared, and an upload over the cap", async () => {
    const url = await command.createUploadUrl({ org: ORG, sizeBytes: 10n });
    const put = await fetch(url.url, { method: "PUT", body: new Uint8Array(11) });
    expect(put.status).toBe(400);

    expect((await errorOf(() => command.createUploadUrl({ org: ORG, sizeBytes: BigInt(CAP + 1) }))).code).toBe(
      Code.InvalidArgument,
    );
    const inline = await errorOf(() =>
      command.upload({ org: ORG, filename: "huge.bin", source: { case: "data", value: new Uint8Array(CAP + 1) } }),
    );
    expect(inline.code).toBe(Code.InvalidArgument);
    expect(inline.rawMessage).toContain(`at most ${CAP} bytes`);
  });

  it("uploads into a conversation, lists under it, and refuses another organization's name for it", async () => {
    const session = await sessions.create(sessionInput(ORG, "Files chat"));
    const sessionId = session.metadata!.id;
    const file = await command.upload({
      org: ORG,
      sessionId,
      filename: "shot.png",
      source: { case: "data", value: new Uint8Array([137, 80, 78, 71]) },
    });
    expect(file.status?.sessionId).toBe(sessionId);
    expect(file.spec?.mimeType).toBe("image/png");
    const listed = await query.list({ org: ORG, sessionId });
    expect(listed.entries.map((entry) => entry.metadata?.id)).toEqual([file.metadata!.id]);

    const elsewhere = await errorOf(() =>
      command.upload({ org: OTHER_ORG, sessionId, filename: "x.txt", source: { case: "data", value: new Uint8Array([1]) } }),
    );
    expect(elsewhere.code).toBe(Code.FailedPrecondition);
  });

  it("deletes a conversation's Files and their bytes with the conversation", async () => {
    const session = await sessions.create(sessionInput(ORG, "Doomed chat"));
    const sessionId = session.metadata!.id;
    const before = blobsOnDisk(dir, orgId).length;
    const ids: string[] = [];
    for (const name of ["a.txt", "b.txt"]) {
      const file = await command.upload({
        org: ORG,
        sessionId,
        filename: name,
        source: { case: "data", value: new TextEncoder().encode(name) },
      });
      ids.push(file.metadata!.id);
    }
    expect(blobsOnDisk(dir, orgId).length).toBe(before + 2);

    await sessions.delete({ value: sessionId });

    for (const id of ids) {
      expect((await errorOf(() => query.get({ value: id }))).code).toBe(Code.NotFound);
    }
    expect(blobsOnDisk(dir, orgId).length).toBe(before);
    expect(await server.store.files.blobKeyOf(ids[0] ?? "")).toBeUndefined();
  });

  it("updates labels, refuses the filename by name, and keeps it under a whole-resource mask", async () => {
    const file = await command.upload({
      org: ORG,
      filename: "notes.md",
      source: { case: "data", value: new TextEncoder().encode("# notes") },
    });
    const labelled = await command.update({
      resource: { ...file, metadata: { ...file.metadata!, labels: { team: "finance" } } },
      updateMask: { paths: ["metadata.labels"] },
    });
    expect(labelled.metadata?.labels).toEqual({ team: "finance" });

    const renamed = await errorOf(() =>
      command.update({
        resource: { ...labelled, spec: create(FileSpecSchema, { filename: "other.md" }) },
        updateMask: { paths: ["spec.filename"] },
      }),
    );
    expect(renamed.code).toBe(Code.InvalidArgument);
    expect(renamed.rawMessage).toContain("written by upload");

    const whole = await command.update({
      resource: { ...labelled, metadata: { ...labelled.metadata!, name: "", labels: {} }, spec: undefined },
      updateMask: { paths: ["*"] },
    });
    expect(whole.spec?.filename).toBe("notes.md");
    expect(whole.metadata?.name).toBe("notes.md");
    expect(whole.metadata?.labels).toEqual({});
  });

  it("deletes a File and its bytes", async () => {
    const before = blobsOnDisk(dir, orgId).length;
    const file = await command.upload({
      org: ORG,
      filename: "gone.txt",
      source: { case: "data", value: new TextEncoder().encode("bye") },
    });
    expect(blobsOnDisk(dir, orgId).length).toBe(before + 1);
    const deleted = await command.delete({ value: file.metadata!.id });
    expect(deleted.metadata?.id).toBe(file.metadata!.id);
    expect(blobsOnDisk(dir, orgId).length).toBe(before);
    expect((await errorOf(() => query.get({ value: file.metadata!.id }))).code).toBe(Code.NotFound);
  });
});

describe("the File controller under an authentication posture (composed server)", () => {
  const CAROL = "fake|file-carol";
  const DAVE = "fake|file-dave";
  const ORG = "files-auth-org";
  let dir: string;
  let server: ComposedServer;
  let port: number;

  const asCarol = (): Transport => transportFor(port, fakeJwt(CAROL, "carol@example.com"));
  const asDave = (): Transport => transportFor(port, fakeJwt(DAVE, "dave@example.com"));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "file-authorization-"));
    vi.stubEnv("STIGMER_ACTIVITY_ROUTING", "session");
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [
        { name: "file-test-auth", requireAuthentication: true, identityVerifiers: [fakeVerifier] },
      ],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
    await createClient(IdentityAccountCommandController, asCarol()).provisionMyAccount({});
    await createClient(OrganizationCommandController, asCarol()).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
    await createClient(IdentityAccountCommandController, asDave()).provisionMyAccount({});
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a member's own File from an admin", async () => {
    const file = await createClient(FileCommandController, asDave()).upload({
      org: ORG,
      filename: "private.txt",
      source: { case: "data", value: new TextEncoder().encode("mine") },
    });
    const read = await errorOf(() => createClient(FileQueryController, asCarol()).get({ value: file.metadata!.id }));
    expect([Code.PermissionDenied, Code.NotFound]).toContain(read.code);
  });

  it("lets only who may send a conversation a message upload into it, and its readers read the File", async () => {
    const session = await createClient(SessionCommandController, asCarol()).create(sessionInput(ORG, "Carol's chat"));
    const sessionId = session.metadata!.id;
    const input = {
      org: ORG,
      sessionId,
      filename: "brief.pdf",
      source: { case: "data" as const, value: new Uint8Array([37, 80, 68, 70]) },
    };

    const refused = await errorOf(() => createClient(FileCommandController, asDave()).upload(input));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toContain("unauthorized to upload a file into this session");

    const file = await createClient(FileCommandController, asCarol()).upload(input);
    expect(file.status?.sessionId).toBe(sessionId);
    expect((await createClient(FileQueryController, asCarol()).get({ value: file.metadata!.id })).spec?.filename).toBe(
      "brief.pdf",
    );
    const read = await errorOf(() => createClient(FileQueryController, asDave()).get({ value: file.metadata!.id }));
    expect([Code.PermissionDenied, Code.NotFound]).toContain(read.code);
    const deleted = await errorOf(() => createClient(FileCommandController, asDave()).delete({ value: file.metadata!.id }));
    expect([Code.PermissionDenied, Code.NotFound]).toContain(deleted.code);
  });
});
