/**
 * Pins the runner's outbound File door (../outputs.ts, registered by
 * ../run-files.ts) over the SQLite store, the real local driver and its
 * transfer lane, and a real runner credential service:
 *   - each output the runner uploads becomes a File of the run's
 *     conversation: written by the run, owned by its creator, named by its
 *     filename, typed by its extension, with where it was saved; two files
 *     of one name in two folders are two Files; a turn's outputs list by
 *     the run;
 *   - a retried registration answers the File it made and promotes
 *     nothing again; a reference spent with no File is FAILED_PRECONDITION;
 *     an output's id is never an attachment conversion's;
 *   - a run a person stopped mints within the grace and not after it, and
 *     registers after it; a finished run otherwise returns nothing;
 *   - everyone but the run's runner gets the one PERMISSION_DENIED;
 *   - a path that leaves the folder, names a folder twice or is not a
 *     filename at its end, and an output over the cap, are refused;
 *   - a conversation deleted while its output lands takes the File back;
 *   - two registrations of one output at once make one File; with no
 *     authorization store none of its access is written; a store fault
 *     reading the run, the output or the conversation is INTERNAL.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import {
  CreateOutputUploadsInputSchema,
  OutputUploadsSchema,
  RegisterOutputsInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import type {
  CreateOutputUploadsInput,
  OutputUploads,
  RegisterOutputsInput,
  RegisteredOutputs,
} from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { ResourceAuthorizationLifecycle, ResourceCreatedEvent } from "../../../extensions/resource-authorization.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { RunnerAuthService } from "../../../runnerauth/runnerauth.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { UploadSlots } from "../../skill/transfer/slots.js";
import { newFileBlobs, uploadRefOf } from "../blobs.js";
import type { FileBlobs } from "../blobs.js";
import { STAGED_FILE_NAME, STAGING_KEY_PREFIX } from "../constants.js";
import { convertedFileId } from "../convert-attachments.js";
import { fileListIndex } from "../list-index.js";
import {
  NOT_THE_RUNS_RUNNER_OUTPUTS_MESSAGE,
  OUTPUT_GRACE_MS,
  createOutputUploads,
  outputFileId,
  outputPathProblem,
  registerOutputs,
} from "../outputs.js";
import type { OutputDeps } from "../outputs.js";
import type { Store } from "../../../store/interface.js";
import { registerRunFileService } from "../run-files.js";
import { fileTransferServeUrl, fileUploadUrl, newFileTransferLane } from "../transfer.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const SESSION = "ses_01outputsoutputsoutputso";
const RUN = "run_01outputsoutputsoutputso";
const CREATOR = "usr_01creatorcreatorcreatorc";
const MAX_BYTES = 1024;
const signer = testUrlSigner();

let root: string;
let lane: http.Server;
let base: string;
let slots: UploadSlots;
let fx: TempStore;
let blobs: FileBlobs;
let auth: RunnerAuthService;
let credentials: RunnerCredentialProvider;
let created: ResourceCreatedEvent[];
let nowMs: number;

const lifecycle: ResourceAuthorizationLifecycle = {
  onResourceCreated: (event) => {
    created.push(event);
    return Promise.resolve();
  },
  onResourceDeleted: () => Promise.resolve(),
  onVisibilityChanged: () => Promise.resolve(),
};

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "file-outputs-"));
  slots = new UploadSlots(root, STAGING_KEY_PREFIX, 60_000, MAX_BYTES, Date.now, STAGED_FILE_NAME);
  const handler = newFileTransferLane({ slots, root, signer, logger: silentLogger });
  lane = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => lane.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(lane.address() as AddressInfo).port}`;
  auth = RunnerAuthService.create(randomBytes(32));
  credentials = newExecutionScopedRunnerCredentialProvider(auth);
});

afterAll(async () => {
  await new Promise<void>((resolve) => lane.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  fx = tempStore();
  created = [];
  nowMs = Date.now();
  const storage = new LocalArtifactStorage(root, fileTransferServeUrl(base), signer, {
    reserve: (key, size) => ({ url: fileUploadUrl(base, uploadRefOf(key)), ...slots.reserve(key, size) }),
  });
  blobs = newFileBlobs({ store: fx.store, storage, logger: silentLogger, maxBytes: MAX_BYTES });
  await fx.store.saveResource(
    ApiResourceKind.session,
    SESSION,
    SessionSchema,
    create(SessionSchema, { metadata: { id: SESSION, org: ORG }, spec: {} }),
  );
  await seedRun(RUN, RunPhase.RUN_IN_PROGRESS);
});

afterEach(async () => {
  await fx.cleanup();
});

function deps(overrides: Partial<OutputDeps> = {}): OutputDeps {
  return {
    store: fx.store,
    logger: silentLogger,
    runnerAuth: credentials,
    blobs,
    lifecycle,
    now: () => nowMs,
    ...overrides,
  };
}

function bearer(token: string): HandlerContext {
  return { requestHeader: new Headers(token === "" ? {} : { authorization: `Bearer ${token}` }) } as unknown as HandlerContext;
}

async function seedRun(runId: string, phase: RunPhase, stop: { cause: string; finishedMsAgo: number } | undefined = undefined): Promise<void> {
  await fx.store.saveResource(
    ApiResourceKind.run,
    runId,
    RunSchema,
    create(RunSchema, {
      metadata: { id: runId, org: ORG },
      spec: { target: { case: "sessionId", value: SESSION } },
      status: {
        phase,
        stopCause: stop?.cause ?? "",
        completedAt: stop === undefined ? "" : new Date(nowMs - stop.finishedMsAgo).toISOString(),
        audit: { specAudit: { createdBy: { id: CREATOR } } },
      },
    }),
  );
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function mint(outputs: Record<string, string>, runId = RUN, token = auth.mintRunCredential(runId), over: Partial<OutputDeps> = {}) {
  const input: CreateOutputUploadsInput = create(CreateOutputUploadsInputSchema, {
    runId,
    entries: Object.entries(outputs).map(([outputPath, text]) => ({ outputPath, sizeBytes: BigInt(Buffer.byteLength(text)) })),
  });
  return createOutputUploads(deps(over), input, bearer(token));
}

async function put(uploads: OutputUploads, outputs: Record<string, string>): Promise<void> {
  for (const entry of uploads.entries) {
    const response = await fetch(entry.url, { method: "PUT", body: outputs[entry.outputPath] ?? "" });
    expect(response.ok, entry.outputPath).toBe(true);
  }
}

function register(
  uploads: OutputUploads,
  outputs: Record<string, string>,
  runId = RUN,
  token = auth.mintRunCredential(runId),
  over: Partial<OutputDeps> = {},
): Promise<RegisteredOutputs> {
  const input: RegisterOutputsInput = create(RegisterOutputsInputSchema, {
    runId,
    entries: uploads.entries.map((entry) => ({
      outputPath: entry.outputPath,
      uploadRef: entry.uploadRef,
      contentSha256: sha256(outputs[entry.outputPath] ?? ""),
    })),
  });
  return registerOutputs(deps(over), input, bearer(token));
}

/** Mints, puts and registers, as the runner does at a turn's end. */
async function returnOutputs(outputs: Record<string, string>, runId = RUN): Promise<File[]> {
  const uploads = await mint(outputs, runId);
  await put(uploads, outputs);
  return (await register(uploads, outputs, runId)).files;
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

async function filesOfRun(runId: string): Promise<File[]> {
  const rows = await fx.store.queryResources(fileListIndex, { org: ORG, anyKey: [{ name: "run", value: runId }] });
  return Promise.all(rows.map((row) => fx.store.getResource(ApiResourceKind.file, row.id, FileSchema)));
}

describe("RunFileController.createOutputUploads and registerOutputs", () => {
  it("returns each output as a File of the run's conversation, two same-named files in two folders as two", async () => {
    const outputs = {
      "variance-q3.csv": "a,b\n1,2\n",
      "reports/north/summary.md": "# North\n",
      "reports/south/summary.md": "# South\n",
    };
    const files = await returnOutputs(outputs);

    expect(files.map((file) => [file.spec?.filename, file.status?.outputPath])).toEqual([
      ["variance-q3.csv", "variance-q3.csv"],
      ["summary.md", "reports/north/summary.md"],
      ["summary.md", "reports/south/summary.md"],
    ]);
    expect(new Set(files.map((file) => file.metadata?.id)).size).toBe(3);
    for (const file of files) {
      expect(file.status?.sessionId).toBe(SESSION);
      expect(file.status?.runId).toBe(RUN);
      expect(file.metadata?.org).toBe(ORG);
      expect(file.status?.audit?.specAudit?.createdBy?.id, "owned by the person who started the run").toBe(CREATOR);
      const stored = await fx.store.getResource(ApiResourceKind.file, file.metadata?.id ?? "", FileSchema);
      expect(stored.status?.outputPath).toBe(file.status?.outputPath);
      const text = outputs[file.status?.outputPath as keyof typeof outputs];
      expect(stored.status?.sizeBytes).toBe(BigInt(Buffer.byteLength(text)));
      expect(new TextDecoder().decode(await blobs.readHead(file.metadata?.id ?? "", MAX_BYTES))).toBe(text);
    }
    expect(files[0]?.spec?.mimeType).toBe("text/csv");
    expect(files[1]?.spec?.mimeType).toBe("text/markdown");
    expect(created.map((event) => [event.resourceId, event.caller.identityId])).toEqual(
      files.map((file) => [file.metadata?.id, CREATOR]),
    );
    expect((await filesOfRun(RUN)).map((file) => file.status?.outputPath).sort()).toEqual(Object.keys(outputs).sort());
  });

  it("answers a retried registration with the File it made, promoting nothing again", async () => {
    const outputs = { "report.md": "first draft" };
    const uploads = await mint(outputs);
    await put(uploads, outputs);
    const first = await register(uploads, outputs);
    const again = await register(uploads, outputs);
    expect(again.files.map((file) => file.metadata?.id)).toEqual(first.files.map((file) => file.metadata?.id));
    expect(await filesOfRun(RUN)).toHaveLength(1);
    // A new reference for the same bytes is not promoted: the File stands.
    const fresh = await mint(outputs);
    const answered = await register(fresh, outputs);
    expect(answered.files[0]?.metadata?.id).toBe(first.files[0]?.metadata?.id);
    expect(await filesOfRun(RUN)).toHaveLength(1);
  });

  it("refuses a reference spent with no File behind it, and never derives a conversion's id", async () => {
    const outputs = { "report.md": "text" };
    const uploads = await mint(outputs);
    await put(uploads, outputs);
    await blobs.promote(ORG, uploads.entries[0]?.uploadRef ?? "");
    expect((await refusal(register(uploads, outputs))).code).toBe(Code.FailedPrecondition);

    const conversions = new Set(Array.from({ length: 50 }, (_, position) => convertedFileId(RUN, position)));
    expect(conversions.has(outputFileId(ORG, RUN, "0", sha256("")))).toBe(false);
    expect(outputFileId(ORG, RUN, "a.md", sha256("x"))).not.toBe(outputFileId(ORG, RUN, "b/a.md", sha256("x")));
    expect(outputFileId(ORG, RUN, "a.md", sha256("x"))).not.toBe(outputFileId(ORG, RUN, "a.md", sha256("y")));
    expect(outputFileId(ORG, RUN, "a.md", sha256("x"))).toMatch(/^file_[0-9a-hjkmnp-tv-z]{26}$/);
  });

  it("lets a run a person stopped mint within the grace and register after it", async () => {
    const outputs = { "notes.md": "saved before the stop" };
    await seedRun(RUN, RunPhase.RUN_CANCELLED, { cause: "user", finishedMsAgo: OUTPUT_GRACE_MS - 1_000 });
    const uploads = await mint(outputs);
    await put(uploads, outputs);
    nowMs += 10 * 60 * 1000;
    expect((await register(uploads, outputs)).files).toHaveLength(1);
    expect((await refusal(mint({ "late.md": "x" }))).code, "minting after the grace").toBe(Code.FailedPrecondition);
  });

  it("returns nothing for a run that finished any other way", async () => {
    const cases: Array<[RunPhase, { cause: string; finishedMsAgo: number } | undefined]> = [
      [RunPhase.RUN_COMPLETED, undefined],
      [RunPhase.RUN_FAILED, undefined],
      [RunPhase.RUN_TERMINATED, undefined],
      [RunPhase.RUN_CANCELLED, { cause: "", finishedMsAgo: 1_000 }],
    ];
    for (const [phase, stop] of cases) {
      await seedRun(RUN, phase, stop);
      expect((await refusal(mint({ "x.md": "x" }))).code, RunPhase[phase]).toBe(Code.FailedPrecondition);
      const uploads = create(OutputUploadsSchema, { entries: [{ outputPath: "x.md", uploadRef: "fup_x" }] });
      expect((await refusal(register(uploads, { "x.md": "x" }))).code, RunPhase[phase]).toBe(Code.FailedPrecondition);
    }
  });

  it("refuses everyone but the run's runner with the one PERMISSION_DENIED", async () => {
    await seedRun("run_01other", RunPhase.RUN_IN_PROGRESS);
    for (const token of ["", "garbage", auth.mintRunCredential("run_01other")]) {
      const error = await refusal(mint({ "x.md": "x" }, RUN, token));
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(NOT_THE_RUNS_RUNNER_OUTPUTS_MESSAGE);
    }
    const nobody = await refusal(mint({ "x.md": "x" }, "run_01nobody"));
    expect(nobody.code).toBe(Code.PermissionDenied);
    const composed: RunnerCredentialProvider = { ...credentials, authorizeRunnerForRun: async () => false };
    expect((await refusal(mint({ "x.md": "x" }, RUN, auth.mintRunCredential(RUN), { runnerAuth: composed }))).code).toBe(
      Code.PermissionDenied,
    );
  });

  it("refuses a path that is not one under the outputs folder, a path named twice, and an output over the cap", async () => {
    for (const bad of ["/etc/passwd", "../escape.md", "a/../b.md", "a//b.md", "a/./b.md", ".", "dir/", "a\\b.md", "nul\u0000.md", `${"d/".repeat(600)}x`]) {
      expect(outputPathProblem(bad), JSON.stringify(bad)).toBeDefined();
      expect((await refusal(mint({ [bad]: "x" }))).code, JSON.stringify(bad)).toBe(Code.InvalidArgument);
    }
    expect(outputPathProblem("reports/2026/q3 summary.md")).toBeUndefined();
    expect(outputPathProblem(`${"é".repeat(255)}`)).toBeUndefined();
    expect(outputPathProblem(`${"é".repeat(256)}`)).toBeDefined();
    const twice = create(CreateOutputUploadsInputSchema, {
      runId: RUN,
      entries: [
        { outputPath: "a.md", sizeBytes: 1n },
        { outputPath: "a.md", sizeBytes: 1n },
      ],
    });
    expect((await refusal(createOutputUploads(deps(), twice, bearer(auth.mintRunCredential(RUN))))).code).toBe(
      Code.InvalidArgument,
    );
    expect((await refusal(mint({ "big.bin": "x".repeat(MAX_BYTES + 1) }))).code).toBe(Code.InvalidArgument);
  });

  it("takes back an output whose conversation was deleted while it landed", async () => {
    const outputs = { "late.md": "after the delete" };
    const uploads = await mint(outputs);
    await put(uploads, outputs);
    await fx.store.deleteResource(ApiResourceKind.session, SESSION);
    expect((await refusal(register(uploads, outputs))).code).toBe(Code.NotFound);
    expect(await filesOfRun(RUN)).toHaveLength(0);
  });

  it("refuses a request with no run, no outputs or an empty path before anything is read", async () => {
    expect(outputPathProblem("")).toBe("output_path is required");
    const token = auth.mintRunCredential(RUN);
    for (const input of [
      create(CreateOutputUploadsInputSchema, { runId: "", entries: [{ outputPath: "a.md", sizeBytes: 1n }] }),
      create(CreateOutputUploadsInputSchema, { runId: RUN, entries: [] }),
    ]) {
      expect((await refusal(createOutputUploads(deps(), input, bearer(token)))).code).toBe(Code.InvalidArgument);
    }
  });

  it("makes one File of two registrations of one output at once", async () => {
    const outputs = { "report.md": "racing" };
    const uploads = await mint(outputs);
    await put(uploads, outputs);
    // The other registration's File lands between this one's look-up and its insert.
    const racing: FileBlobs = {
      ...blobs,
      insertFile: async (id, schema, file, blob) => {
        await blobs.insertFile(id, schema, file, blob);
        throw new Error("file id already held");
      },
    };
    const files = (await register(uploads, outputs, RUN, auth.mintRunCredential(RUN), { blobs: racing })).files;
    expect(files).toHaveLength(1);
    expect(await filesOfRun(RUN)).toHaveLength(1);

    const fresh = await mint({ "other.md": "lost" });
    await put(fresh, { "other.md": "lost" });
    const failing: FileBlobs = { ...blobs, insertFile: () => Promise.reject(new Error("disk full")) };
    await expect(register(fresh, { "other.md": "lost" }, RUN, auth.mintRunCredential(RUN), { blobs: failing })).rejects.toThrow("disk full");
  });

  it("writes no access with no authorization store, and the File still lands", async () => {
    const files = await (async () => {
      const outputs = { "quiet.md": "no store" };
      const uploads = await mint(outputs);
      await put(uploads, outputs);
      return (await register(uploads, outputs, RUN, auth.mintRunCredential(RUN), { lifecycle: undefined })).files;
    })();
    expect(files).toHaveLength(1);
    expect(created).toEqual([]);
  });

  it("answers INTERNAL when the run, an output or the conversation cannot be read", async () => {
    const outputs = { "fault.md": "x" };
    for (const kind of [ApiResourceKind.run, ApiResourceKind.file, ApiResourceKind.session]) {
      const uploads = kind === ApiResourceKind.run ? undefined : await mint(outputs);
      if (uploads !== undefined) await put(uploads, outputs);
      const store = new Proxy(fx.store, {
        get(target, property, receiver) {
          if (property === "getResource") {
            return (asked: ApiResourceKind, ...rest: unknown[]) =>
              asked === kind
                ? Promise.reject(new Error("database unreachable"))
                : (target.getResource as (...args: unknown[]) => Promise<unknown>).call(target, asked, ...rest);
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      }) as Store;
      const answer =
        uploads === undefined
          ? mint(outputs, RUN, auth.mintRunCredential(RUN), { store })
          : register(uploads, outputs, RUN, auth.mintRunCredential(RUN), { store });
      expect((await refusal(answer)).code, ApiResourceKind[kind]).toBe(Code.Internal);
    }
  });

  it("serves both methods through the registered service", async () => {
    type Served = {
      createOutputUploads: (input: CreateOutputUploadsInput, ctx: HandlerContext) => Promise<OutputUploads>;
      registerOutputs: (input: RegisterOutputsInput, ctx: HandlerContext) => Promise<RegisteredOutputs>;
    };
    let served: Served | undefined;
    const router = {
      service: (_service: unknown, implementation: Served) => {
        served = implementation;
        return router;
      },
    } as unknown as ConnectRouter;
    registerRunFileService(router, deps());
    const outputs = { "served.md": "through the service" };
    const token = auth.mintRunCredential(RUN);
    const uploads = await served!.createOutputUploads(
      create(CreateOutputUploadsInputSchema, { runId: RUN, entries: [{ outputPath: "served.md", sizeBytes: 19n }] }),
      bearer(token),
    );
    await put(uploads, outputs);
    const registered = await served!.registerOutputs(
      create(RegisterOutputsInputSchema, {
        runId: RUN,
        entries: [{ outputPath: "served.md", uploadRef: uploads.entries[0]?.uploadRef ?? "", contentSha256: sha256(outputs["served.md"]) }],
      }),
      bearer(token),
    );
    expect(registered.files[0]?.status?.outputPath).toBe("served.md");
  });
});
