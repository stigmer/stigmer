// File conformance — the kind's contract on every edition (Class A).
// Domain: conformance suites.
//
// A File is a file uploaded once and named by its id, shaped as Claude's
// Files API object. Every edition answers alike:
//
//   - an inline upload mints a file_ id, records the filename, the type its
//     extension gives and the size, and starts private; get and list find
//     it, and a conversation's list holds only that conversation's Files;
//   - an upload through an upload URL (createUploadUrl, an HTTP PUT of
//     exactly the declared bytes with no credential but the URL, upload by
//     reference) yields the same File, and the reference is spent;
//   - the download link serves the File's bytes, and its answer names
//     nothing of where they are stored beyond the link itself;
//   - update changes labels and refuses the filename, naming the door that
//     writes it; updateVisibility widens it to the organization; delete
//     removes it;
//   - deleting a conversation deletes the Files uploaded into it;
//   - the mount that hands a runner a conversation's Files with links to
//     their bytes answers only the runner acting for the run: a person's
//     own credential is refused. The runner's own mount, on real turns, is
//     the execution suite's (suites-execution/run.conformance.test.ts).
//
// Deliberately out of scope: the size cap (an operator setting the server's
// own suite pins), the blob store's sharing and sweeps (the server's unit
// suites), and who may upload or read (the authorization model's tests and
// the server's composed suite).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

async function uploadInline(org: string, filename: string, text: string, sessionId = "") {
  const file = await clients.fileCommand.upload({
    org,
    sessionId,
    filename,
    source: { case: "data", value: new TextEncoder().encode(text) },
  });
  const id = file.metadata!.id;
  fixtures.defer(() => clients.fileCommand.delete({ value: id }).catch(() => undefined));
  return file;
}

async function newSession(org: string): Promise<string> {
  const session = await clients.sessionCommand.create(makeSession({ org, name: uniqueName("files") }));
  const id = session.metadata!.id;
  fixtures.defer(() => clients.sessionCommand.delete({ value: id }).catch(() => undefined));
  return id;
}

describe("File conformance — uploads and identity", () => {
  it("[rpc:FileCommandController.upload] an inline upload mints a file_ id, records name, type and size, and starts private", async () => {
    const { org } = await target.provisionTenancy();
    const file = await uploadInline(org, "notes.md", "# notes\n");

    expect(file.metadata?.id).toMatch(/^file_[0-9a-z]{26}$/);
    expect(file.metadata?.org).toBe(org);
    expect(file.spec?.filename).toBe("notes.md");
    expect(file.spec?.mimeType).toBe("text/markdown");
    expect(file.status?.sizeBytes).toBe(8n);
    expect(file.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
  });

  it("[rpc:FileCommandController.createUploadUrl] an upload URL takes exactly the declared bytes, and its reference uploads once", async () => {
    const { org } = await target.provisionTenancy();
    const bytes = new Uint8Array(4096).map((_, i) => i % 251);
    const url = await clients.fileCommand.createUploadUrl({ org, sizeBytes: BigInt(bytes.length) });
    expect(url.uploadRef).not.toBe("");
    expect(url.ttlSeconds).toBeGreaterThan(0);

    const put = await fetch(url.url, { method: "PUT", body: bytes });
    expect(put.ok, `PUT answered ${put.status}`).toBe(true);

    const file = await clients.fileCommand.upload({
      org,
      filename: "data.bin",
      source: { case: "uploadRef", value: url.uploadRef },
    });
    fixtures.defer(() => clients.fileCommand.delete({ value: file.metadata!.id }).catch(() => undefined));
    expect(file.status?.sizeBytes).toBe(4096n);
    expect(file.spec?.mimeType).toBe("application/octet-stream");

    await expectGrpcCode(
      () => clients.fileCommand.upload({ org, filename: "again.bin", source: { case: "uploadRef", value: url.uploadRef } }),
      Code.FailedPrecondition,
      "an upload reference is spent by its upload",
    );
  });

  it("[rpc:FileQueryController.getDownloadUrl] the download link serves the File's bytes", async () => {
    const { org } = await target.provisionTenancy();
    const file = await uploadInline(org, "hello.txt", "hello, files");

    const link = await clients.fileQuery.getDownloadUrl({ value: file.metadata!.id });
    expect(link.expiresAt).toBeDefined();
    const response = await fetch(link.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello, files");
  });

  it("[rpc:FileQueryController.get] [rpc:FileQueryController.list] get and list find it, and a conversation's list holds only its own Files", async () => {
    const { org } = await target.provisionTenancy();
    const own = await uploadInline(org, "own.txt", "own");
    const sessionId = await newSession(org);
    const given = await uploadInline(org, "given.txt", "given", sessionId);

    expect((await clients.fileQuery.get({ value: own.metadata!.id })).spec?.filename).toBe("own.txt");
    expect(given.status?.sessionId).toBe(sessionId);
    const all = (await clients.fileQuery.list({ org })).entries.map((f) => f.metadata?.id);
    expect(all).toEqual(expect.arrayContaining([own.metadata!.id, given.metadata!.id]));
    const conversation = (await clients.fileQuery.list({ org, sessionId })).entries.map((f) => f.metadata?.id);
    expect(conversation).toEqual([given.metadata!.id]);
  });
});

describe("File conformance — changes and deletes", () => {
  it("[rpc:FileCommandController.update] update changes labels and refuses the filename, naming its door", async () => {
    const { org } = await target.provisionTenancy();
    const file = await uploadInline(org, "ledger.csv", "a,b\n");

    const labelled = await clients.fileCommand.update({
      resource: { metadata: { id: file.metadata!.id, org, labels: { quarter: "q3" } } },
      updateMask: { paths: ["metadata.labels"] },
    });
    expect(labelled.metadata?.labels).toEqual({ quarter: "q3" });
    expect(labelled.spec?.filename).toBe("ledger.csv");

    const refused = await expectGrpcCode(
      () =>
        clients.fileCommand.update({
          resource: { metadata: { id: file.metadata!.id, org }, spec: { filename: "renamed.csv" } },
          updateMask: { paths: ["spec.filename"] },
        }),
      Code.InvalidArgument,
      "a File's filename is its upload's",
    );
    expect(refused.rawMessage).toContain("written by upload");
  });

  it("[rpc:FileCommandController.updateVisibility] updateVisibility shares it with the organization", async () => {
    const { org } = await target.provisionTenancy();
    const file = await uploadInline(org, "shared.txt", "for everyone");

    const widened = await clients.fileCommand.updateVisibility({
      resourceId: file.metadata!.id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(widened.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
  });

  it("[rpc:FileCommandController.delete] delete removes it", async () => {
    const { org } = await target.provisionTenancy();
    const file = await clients.fileCommand.upload({
      org,
      filename: "gone.txt",
      source: { case: "data", value: new TextEncoder().encode("bye") },
    });

    const deleted = await clients.fileCommand.delete({ value: file.metadata!.id });
    expect(deleted.metadata?.id).toBe(file.metadata!.id);
    await expectGrpcCode(
      () => clients.fileQuery.get({ value: file.metadata!.id }),
      Code.NotFound,
      "a deleted File is gone",
    );
  });

  it("deleting a conversation deletes the Files uploaded into it", async () => {
    const { org } = await target.provisionTenancy();
    const session = await clients.sessionCommand.create(makeSession({ org, name: uniqueName("files") }));
    const sessionId = session.metadata!.id;
    const file = await clients.fileCommand.upload({
      org,
      sessionId,
      filename: "screenshot.png",
      source: { case: "data", value: new Uint8Array([137, 80, 78, 71]) },
    });

    await clients.sessionCommand.delete({ value: sessionId });
    await expectGrpcCode(
      () => clients.fileQuery.get({ value: file.metadata!.id }),
      Code.NotFound,
      "a conversation's File goes with it",
    );
  });
});

describe("File conformance — the runner's door", () => {
  it("[rpc:RunFileController.mount] a person's own credential is no runner's: mounting a run's Files is refused", async () => {
    const refused = await expectGrpcCode(
      () => clients.runFiles.mount({ runId: "run_01conformancenotarunner" }),
      Code.PermissionDenied,
      "mount with a signed-in person's credential",
    );
    expect(refused.rawMessage).toBe("only the runner acting for this run may mount its files");
  });

  it("[rpc:RunFileController.createOutputUploads] [rpc:RunFileController.registerOutputs] a person's own credential returns no run's outputs", async () => {
    const minted = await expectGrpcCode(
      () => clients.runFiles.createOutputUploads({ runId: "run_01conformancenotarunner", entries: [{ outputPath: "report.md", sizeBytes: 3n }] }),
      Code.PermissionDenied,
      "minting an output's upload with a signed-in person's credential",
    );
    expect(minted.rawMessage).toBe("only the runner acting for this run may return its outputs");
    const registered = await expectGrpcCode(
      () =>
        clients.runFiles.registerOutputs({
          runId: "run_01conformancenotarunner",
          entries: [{ outputPath: "report.md", uploadRef: "fup_00000000000000000000000000000000", contentSha256: "0".repeat(64) }],
        }),
      Code.PermissionDenied,
      "registering an output with a signed-in person's credential",
    );
    expect(registered.rawMessage).toBe("only the runner acting for this run may return its outputs");
  });

  it("[rpc:RunFileController.createOutputUploads] refuses a path that is not one under the outputs folder before anything else", async () => {
    await expectGrpcCode(
      () => clients.runFiles.createOutputUploads({ runId: "run_01conformancenotarunner", entries: [{ outputPath: "../escape.md", sizeBytes: 3n }] }),
      Code.InvalidArgument,
      "a path that climbs out of the folder",
    );
  });
});

describe("File conformance — reading and listing", () => {
  it("[rpc:FileQueryController.getContent] reads a File's first bytes through the server, and says when there is more", async () => {
    const { org } = await target.provisionTenancy();
    const text = "line one\nline two\n";
    const file = await clients.fileCommand.upload({ org, filename: "notes.md", source: { case: "data", value: new TextEncoder().encode(text) } });
    const id = file.metadata!.id;
    fixtures.defer(() => clients.fileCommand.delete({ value: id }).catch(() => undefined));

    const whole = await clients.fileQuery.getContent({ id });
    expect(new TextDecoder().decode(whole.data)).toBe(text);
    expect(whole.truncated).toBe(false);
    const head = await clients.fileQuery.getContent({ id, maxBytes: 4n });
    expect(new TextDecoder().decode(head.data)).toBe("line");
    expect(head.truncated).toBe(true);
  });

  it("[rpc:FileQueryController.list] lists only the Files a run wrote when asked for a run's", async () => {
    const { org } = await target.provisionTenancy();
    const file = await clients.fileCommand.upload({ org, filename: "mine.txt", source: { case: "data", value: new Uint8Array([1]) } });
    fixtures.defer(() => clients.fileCommand.delete({ value: file.metadata!.id }).catch(() => undefined));
    const listed = await clients.fileQuery.list({ org, runId: "run_01conformancenoturnsfiles" });
    expect(listed.entries).toEqual([]);
  });
});
