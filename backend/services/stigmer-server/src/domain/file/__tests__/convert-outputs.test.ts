/**
 * Pins the boot pass that turns a run's stored files into Files of the run
 * (../convert-outputs.ts) over the SQLite store and the real local driver,
 * the conversion rows seeded as the store's migration leaves them:
 *   - each file becomes a File of its run, in the run's conversation, over
 *     the bytes at its key with their real size, owned by the run's
 *     creator, with the run's id and its name as output path, its access
 *     written as a create's is, and it lists under its run; the row goes;
 *   - a second pass over the same row converges: one File, its access
 *     written again;
 *   - a file whose bytes, run or conversation is gone, or whose run is in
 *     no conversation, is skipped and its row forgotten;
 *   - so is one whose key is not `artifacts/<its run's id>/<its name>`
 *     with a one-segment name (another run's folder, a deeper key, a
 *     traversal, another name), and one whose key's blob row is another
 *     organization's;
 *   - a blob that turns unavailable before its File is written is skipped
 *     and its row forgotten, and any other fault writing the File stops the
 *     pass with the row kept;
 *   - a storage fault stops the pass with the row kept;
 *   - a converted File's id is derived from its run and position under its
 *     own tag, never an attachment's.
 *
 * And over a composed server: a database a release left with a run's
 * stored file boots, the file lists under its run with its output path,
 * and its link downloads its bytes through the Files lane.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, toBinary } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ResourceAuthorizationLifecycle, ResourceCreatedEvent } from "../../../extensions/resource-authorization.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { FileBlobUnavailableError } from "../../../store/file-blobs.js";
import type { OutputConversion } from "../../../store/file-blobs.js";
import type { Store } from "../../../store/interface.js";
import { runRowWithArtifacts } from "../../../store/__tests__/retired-run-artifact-rows.js";
import { SCHEMA_VERSION_44 } from "../../../store/sqlite/migrations.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { organizationId, seedOrganizations } from "../../organization/__tests__/support.js";
import { convertedFileId } from "../convert-attachments.js";
import { convertStoredOutputs, convertedOutputFileId, isStoredRunFileKey } from "../convert-outputs.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const SESSION = "ses_01convertconvertconvert";
const CREATOR = "acc_01creatorcreatorcreatorc";
const keyOf = (runId: string, name: string) => `artifacts/${runId}/${name}`;

let fx: TempStore;
let root: string;
let storage: LocalArtifactStorage;
let created: ResourceCreatedEvent[];

const lifecycle: ResourceAuthorizationLifecycle = {
  onResourceCreated: (event) => {
    created.push(event);
    return Promise.resolve();
  },
  onResourceDeleted: () => Promise.resolve(),
  onVisibilityChanged: () => Promise.resolve(),
};

beforeEach(async () => {
  fx = tempStore();
  await fx.store.saveResource(
    ApiResourceKind.session,
    SESSION,
    SessionSchema,
    create(SessionSchema, { metadata: { id: SESSION, org: ORG } }),
  );
  root = mkdtempSync(path.join(tmpdir(), "convert-outputs-"));
  storage = new LocalArtifactStorage(root, "http://files.test", testUrlSigner());
  created = [];
});

afterEach(async () => {
  await fx.cleanup();
  rmSync(root, { recursive: true, force: true });
});

function seedConversion(conversion: Partial<OutputConversion> & Pick<OutputConversion, "runId">): void {
  const name = conversion.name ?? "report.md";
  const row: OutputConversion = {
    position: 0,
    org: ORG,
    sessionId: SESSION,
    name,
    storageKey: keyOf(conversion.runId, name),
    createdAt: "2026-10-02T09:00:00.000000000Z",
    ...conversion,
  };
  const db = new DatabaseSync(fx.dbPath);
  try {
    db.prepare(
      `INSERT INTO output_conversions
         (run_id, position, org, session_id, name, storage_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.runId, row.position, row.org, row.sessionId, row.name, row.storageKey, row.createdAt);
  } finally {
    db.close();
  }
}

async function seedRun(runId: string): Promise<void> {
  await fx.store.saveResource(
    ApiResourceKind.run,
    runId,
    RunSchema,
    create(RunSchema, {
      metadata: { id: runId, org: ORG },
      spec: { target: { case: "sessionId", value: SESSION }, message: "write the report" },
      status: { audit: { specAudit: { createdBy: { id: CREATOR } } } },
    }),
  );
}

async function conversionCount(): Promise<number> {
  return (await fx.store.files.listOutputConversions(100)).length;
}

function convert(over: Partial<{ storage: ArtifactStorage }> = {}): Promise<number> {
  return convertStoredOutputs({ store: fx.store, storage: over.storage ?? storage, lifecycle, logger: silentLogger });
}

describe("converting a run's stored files", () => {
  it("makes each an output File of its run over its bytes, owned by the run's creator", async () => {
    await storage.upload(keyOf("run_01convert", "report.md"), new TextEncoder().encode("# Q3"), "text/markdown");
    await storage.upload(keyOf("run_01convert", "chart.png"), new Uint8Array([137, 80, 78, 71, 13]), "image/png");
    await seedRun("run_01convert");
    seedConversion({ runId: "run_01convert" });
    seedConversion({ runId: "run_01convert", position: 2, name: "chart.png" });

    expect(await convert()).toBe(2);

    const reportId = convertedOutputFileId("run_01convert", 0);
    const chartId = convertedOutputFileId("run_01convert", 2);
    const report = await fx.store.getResource(ApiResourceKind.file, reportId, FileSchema);
    expect([
      report.spec?.filename,
      report.spec?.mimeType,
      report.status?.sizeBytes,
      report.status?.sessionId,
      report.status?.runId,
      report.status?.outputPath,
    ]).toEqual(["report.md", "text/markdown", 4n, SESSION, "run_01convert", "report.md"]);
    expect(report.status?.audit?.specAudit?.createdBy?.id).toBe(CREATOR);
    expect(await fx.store.files.blobKeyOf(reportId)).toBe(keyOf("run_01convert", "report.md"));
    expect((await fx.store.files.getBlob(keyOf("run_01convert", "report.md")))?.state).toBe("stored");
    expect(created.map((event) => [event.kind, event.resourceId, event.caller.identityId])).toEqual([
      [ApiResourceKind.file, reportId, CREATOR],
      [ApiResourceKind.file, chartId, CREATOR],
    ]);
    expect(await conversionCount()).toBe(0);
  });

  it("converges when a pass stopped after the File was made: one File, its access rewritten", async () => {
    await storage.upload(keyOf("run_01again", "report.md"), new Uint8Array([1]), "");
    await seedRun("run_01again");
    seedConversion({ runId: "run_01again" });
    await convert();
    seedConversion({ runId: "run_01again" });
    expect(await convert()).toBe(1);

    const id = convertedOutputFileId("run_01again", 0);
    expect(created.map((event) => event.resourceId)).toEqual([id, id]);
    expect(await conversionCount()).toBe(0);
  });

  it("skips and forgets a file whose bytes, run or conversation is gone, or whose run is in no conversation", async () => {
    await seedRun("run_01nobytes");
    seedConversion({ runId: "run_01nobytes" });
    seedConversion({ runId: "run_01norun" });
    await storage.upload(keyOf("run_01lonely", "report.md"), new Uint8Array([1]), "");
    await seedRun("run_01lonely");
    seedConversion({ runId: "run_01lonely", sessionId: "" });
    await storage.upload(keyOf("run_01orphan", "report.md"), new Uint8Array([1]), "");
    await seedRun("run_01orphan");
    seedConversion({ runId: "run_01orphan", sessionId: "ses_01gone" });

    expect(await convert()).toBe(0);
    expect(await conversionCount()).toBe(0);
    expect(created).toEqual([]);
  });

  it("trusts a key only as the engine wrote it, in the run's own folder, for the row's own one-segment name", async () => {
    await seedRun("run_01keys");
    const keys: Array<[string, string]> = [
      [keyOf("run_01other", "report.md"), "report.md"],
      [keyOf("run_01keys", "filereview/cas/blobs/abc"), "abc"],
      [keyOf("run_01keys", "toolcalls/call_1.txt"), "toolcalls/call_1.txt"],
      ["artifacts/run_01keys/../run_01other/report.md", "report.md"],
      [keyOf("run_01keys", "other.md"), "report.md"],
      [keyOf("run_01keys", ".."), ".."],
      [`files/${ORG}/0123456789abcdef`, "0123456789abcdef"],
    ];
    for (const [position, [storageKey, name]] of keys.entries()) {
      seedConversion({ runId: "run_01keys", position, storageKey, name });
    }
    expect(await convert()).toBe(0);
    expect(await conversionCount()).toBe(0);
    expect(created).toEqual([]);
    expect(isStoredRunFileKey(keyOf("run_01keys", "report.md"), "run_01keys", "report.md")).toBe(true);
    expect(isStoredRunFileKey("artifacts//report.md", "", "report.md")).toBe(false);
  });

  it("skips a key whose blob row is another organization's", async () => {
    await storage.upload(keyOf("run_01blobs", "report.md"), new Uint8Array([1]), "");
    await fx.store.files.recordBlob({
      blobKey: keyOf("run_01blobs", "report.md"),
      org: "org_01bbbbbbbbbbbbbbbbbbbbbbbb",
      state: "stored",
      sizeBytes: 1,
      expiresAt: 0,
    });
    await seedRun("run_01blobs");
    seedConversion({ runId: "run_01blobs" });
    expect(await convert()).toBe(0);
    expect(await conversionCount()).toBe(0);
  });

  /** The test store with its File door's insert replaced. */
  function withInsert(insert: Store["files"]["insert"]): Store {
    const files = new Proxy(fx.store.files, {
      get(target, property, receiver) {
        if (property === "insert") {
          return insert;
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    return new Proxy(fx.store, {
      get(target, property, receiver) {
        if (property === "files") {
          return files;
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  it("skips a blob that turns unavailable before its File is written, and stops on any other fault writing it", async () => {
    await storage.upload(keyOf("run_01gone", "report.md"), new Uint8Array([1]), "");
    await seedRun("run_01gone");
    seedConversion({ runId: "run_01gone" });
    const unavailable = withInsert(() =>
      Promise.reject(new FileBlobUnavailableError(keyOf("run_01gone", "report.md"), "it is orphaned past its expiry")),
    );
    expect(await convertStoredOutputs({ store: unavailable, storage, lifecycle, logger: silentLogger })).toBe(0);
    expect(await conversionCount()).toBe(0);
    expect(created).toEqual([]);

    seedConversion({ runId: "run_01gone", position: 1 });
    const faulty = withInsert(() => Promise.reject(new Error("database unreachable")));
    await expect(convertStoredOutputs({ store: faulty, storage, lifecycle, logger: silentLogger })).rejects.toThrow(
      "database unreachable",
    );
    expect(await conversionCount()).toBe(1);
  });

  it("stops on a storage fault, keeping the row for the next boot", async () => {
    await seedRun("run_01fault");
    seedConversion({ runId: "run_01fault" });
    const faulty: ArtifactStorage = Object.assign(Object.create(storage) as ArtifactStorage, {
      size: () => Promise.reject(new Error("bucket unreachable")),
    });
    await expect(convert({ storage: faulty })).rejects.toThrow("bucket unreachable");
    expect(await conversionCount()).toBe(1);
  });

  it("derives a File's id from its run and position under its own tag, shaped as a minted one", () => {
    expect(convertedOutputFileId("run_1", 0)).toBe(convertedOutputFileId("run_1", 0));
    expect(convertedOutputFileId("run_1", 0)).not.toBe(convertedOutputFileId("run_1", 1));
    expect(convertedOutputFileId("run_1", 0)).not.toBe(convertedFileId("run_1", 0));
    expect(convertedOutputFileId("run_1", 0)).toMatch(/^file_[0-9a-hjkmnp-tv-z]{26}$/);
  });
});

describe("an install with a run's stored file, booted", () => {
  it("lists the file under its run with its output path, and its link downloads its bytes through the Files lane", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "convert-outputs-boot-"));
    try {
      const dbPath = path.join(dir, "stigmer.db");
      const artifacts = path.join(dir, "artifacts");
      // An empty boot first, to mint the organization the old rows belong to.
      const config = loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: dbPath,
        ARTIFACT_LOCAL_BASE_PATH: artifacts,
        STORAGE_PATH: path.join(dir, "storage"),
      });
      let server = await composeServer({ config, logger: silentLogger, portOverride: 0, host: "127.0.0.1" });
      let port = await server.start();
      const orgId = organizationId(await seedOrganizations(createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` }), ["acme"]), "acme");
      await server.shutdown();

      // Put the database back to the release before the step, holding a run
      // the engine uploaded a file for.
      const runId = "run_01bootbootbootbootbootboot";
      const sessionId = "ses_01bootbootbootbootbootboot";
      const db = new DatabaseSync(dbPath);
      try {
        db.exec(`DROP TABLE output_conversions; DROP TABLE session_queued_messages; DELETE FROM schema_version WHERE version > ${SCHEMA_VERSION_44};`);
        const insert = db.prepare(`INSERT INTO resources (kind, id, data, updated_at) VALUES (?, ?, ?, '2026-10-02 00:00:00')`);
        insert.run(
          "session",
          sessionId,
          toBinary(SessionSchema, create(SessionSchema, { metadata: { id: sessionId, org: orgId }, spec: { subject: "Q3" } })),
        );
        insert.run(
          "run",
          runId,
          runRowWithArtifacts(
            { metadata: { id: runId, org: orgId }, spec: { target: { case: "sessionId", value: sessionId } }, status: {} },
            [{ name: "q3.md", kind: 1, storageKey: keyOf(runId, "q3.md") }],
          ),
        );
      } finally {
        db.close();
      }
      mkdirSync(path.join(artifacts, "artifacts", runId), { recursive: true });
      writeFileSync(path.join(artifacts, keyOf(runId, "q3.md")), "# Q3 numbers");

      server = await composeServer({ config, logger: silentLogger, portOverride: 0, host: "127.0.0.1" });
      port = await server.start();
      try {
        const files = createClient(FileQueryController, createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` }));
        const listed = await files.list({ org: "acme", runId });
        expect(listed.entries.map((file) => [file.spec?.filename, file.status?.runId, file.status?.outputPath])).toEqual([
          ["q3.md", runId, "q3.md"],
        ]);
        const link = await files.getDownloadUrl({ value: listed.entries[0]?.metadata?.id ?? "" });
        const response = await fetch(link.url);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("# Q3 numbers");
      } finally {
        await server.shutdown();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // Two boots of the composed server, each about seven seconds here.
  }, 60_000);
});
