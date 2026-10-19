/**
 * Pins the runner's File mount (../mount.ts) over the SQLite store, the
 * real local driver and a real runner credential service:
 *   - the runner acting for the run gets its conversation's Files, in the
 *     list's order, each with its mount path, name, type, size and a link
 *     that serves its bytes;
 *   - a File gone since, one whose bytes went, or one that is not the
 *     conversation's own, is left out, as is a repository beside them; a run
 *     in no conversation mounts nothing, served through the registered
 *     service as through the handler;
 *   - no bearer, garbage, another run's credential, a run nobody holds and
 *     a composed decision that refuses are each the one PERMISSION_DENIED;
 *     a finished run is refused; a run_id is required;
 *   - a conversation that is gone is refused;
 *   - a store fault reading the run, the conversation or a File is
 *     INTERNAL.
 */
import { randomBytes } from "node:crypto";
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
import { MountRunFilesInputSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/mount_pb";
import type { MountRunFilesInput, RunFileMounts } from "@stigmer/apis/ai/stigmer/agentic/file/v1/mount_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import type { SessionResource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../../artifactstorage/__test-utils__/url-signer.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { RunnerAuthService } from "../../../runnerauth/runnerauth.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { UploadSlots } from "../../skill/transfer/slots.js";
import { newFileBlobs } from "../blobs.js";
import type { FileBlobs } from "../blobs.js";
import { STAGED_FILE_NAME, STAGING_KEY_PREFIX } from "../constants.js";
import { NOT_THE_RUNS_RUNNER_MOUNT_MESSAGE, mountRunFiles, registerFileMountService } from "../mount.js";
import type { FileMountDeps } from "../mount.js";
import { fileTransferServeUrl, newFileTransferLane } from "../transfer.js";

const ORG = "org_01aaaaaaaaaaaaaaaaaaaaaaaa";
const SESSION = "ses_01mountmountmountmountmo";
const signer = testUrlSigner();

let root: string;
let lane: http.Server;
let base: string;
let fx: TempStore;
let blobs: FileBlobs;
let auth: RunnerAuthService;
let credentials: RunnerCredentialProvider;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "file-mount-"));
  const slots = new UploadSlots(root, STAGING_KEY_PREFIX, 60_000, 1024, Date.now, STAGED_FILE_NAME);
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

beforeEach(() => {
  fx = tempStore();
  const storage = new LocalArtifactStorage(root, fileTransferServeUrl(base), signer);
  blobs = newFileBlobs({ store: fx.store, storage, logger: silentLogger, maxBytes: 1024 });
});

afterEach(async () => {
  await fx.cleanup();
});

function deps(overrides: Partial<FileMountDeps> = {}): FileMountDeps {
  return { store: fx.store, logger: silentLogger, runnerAuth: credentials, blobs, ...overrides };
}

function bearer(token: string): HandlerContext {
  return { requestHeader: new Headers(token === "" ? {} : { authorization: `Bearer ${token}` }) } as unknown as HandlerContext;
}

async function seedRun(runId: string, sessionId: string, phase = RunPhase.RUN_IN_PROGRESS): Promise<void> {
  await fx.store.saveResource(
    ApiResourceKind.run,
    runId,
    RunSchema,
    create(RunSchema, {
      metadata: { id: runId, org: ORG },
      spec: sessionId === "" ? {} : { target: { case: "sessionId", value: sessionId } },
      status: { phase },
    }),
  );
}

async function seedFile(id: string, filename: string, text: string, sessionId = SESSION): Promise<void> {
  const blob = await blobs.storeInline(ORG, new TextEncoder().encode(text), "");
  await blobs.insertFile(
    id,
    FileSchema,
    create(FileSchema, {
      metadata: { id, org: ORG, name: filename },
      spec: { filename, mimeType: "text/plain" },
      status: { sizeBytes: BigInt(text.length), sessionId },
    }),
    blob,
  );
}

async function seedSession(files: Array<[string, string]>, extra: SessionResource[] = []): Promise<void> {
  await fx.store.saveResource(
    ApiResourceKind.session,
    SESSION,
    SessionSchema,
    create(SessionSchema, {
      metadata: { id: SESSION, org: ORG },
      spec: {
        resources: [
          ...extra,
          ...files.map(([fileId, mountPath]) =>
            create(SessionResourceSchema, { resource: { case: "file", value: { fileId, mountPath } } }),
          ),
        ],
      },
    }),
  );
}

function mount(runId: string, token: string, overrides: Partial<FileMountDeps> = {}) {
  return mountRunFiles(deps(overrides), create(MountRunFilesInputSchema, { runId }), bearer(token));
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

describe("FileMountController.mount", () => {
  it("hands the run's runner its conversation's own Files, in order, with links that serve them", async () => {
    await seedFile("file_01a", "a.txt", "alpha");
    await seedFile("file_01b", "b.txt", "bravo");
    await seedFile("file_01elsewhere", "c.txt", "charlie", "ses_01other");
    // A File row with no blob behind it: its bytes went.
    await fx.store.saveResource(
      ApiResourceKind.file,
      "file_01nobytes",
      FileSchema,
      create(FileSchema, { metadata: { id: "file_01nobytes", org: ORG }, status: { sessionId: SESSION } }),
    );
    await seedSession(
      [
        ["file_01b", "docs/b.txt"],
        ["file_01gone", "gone.txt"],
        ["file_01elsewhere", "c.txt"],
        ["file_01nobytes", "nobytes.txt"],
        ["file_01a", "a.txt"],
      ],
      [create(SessionResourceSchema, { name: "app", resource: { case: "gitRepository", value: { url: "https://github.com/acme/app" } } })],
    );
    await seedRun("run_01m", SESSION);

    const mounts = await mount("run_01m", auth.mintRunCredential("run_01m"));
    expect(mounts.entries.map((entry) => [entry.fileId, entry.mountPath, entry.filename, entry.mimeType, entry.sizeBytes])).toEqual([
      ["file_01b", "docs/b.txt", "b.txt", "text/plain", 5n],
      ["file_01a", "a.txt", "a.txt", "text/plain", 5n],
    ]);
    expect(await (await fetch(mounts.entries[0]!.url)).text()).toBe("bravo");
  });

  it("mounts nothing for a run in no conversation, through the registered service too", async () => {
    await seedRun("run_01lonely", "");
    expect((await mount("run_01lonely", auth.mintRunCredential("run_01lonely"))).entries).toEqual([]);

    let served: { mount: (input: MountRunFilesInput, ctx: HandlerContext) => Promise<RunFileMounts> } | undefined;
    const router = {
      service: (_service: unknown, implementation: typeof served) => {
        served = implementation;
        return router;
      },
    } as unknown as ConnectRouter;
    registerFileMountService(router, deps());
    const answer = await served!.mount(
      create(MountRunFilesInputSchema, { runId: "run_01lonely" }),
      bearer(auth.mintRunCredential("run_01lonely")),
    );
    expect(answer.entries).toEqual([]);
  });

  it("answers INTERNAL when the run, the conversation or a File cannot be read", async () => {
    await seedFile("file_01a", "a.txt", "alpha");
    await seedSession([["file_01a", "a.txt"]]);
    await seedRun("run_01m", SESSION);
    for (const kind of [ApiResourceKind.run, ApiResourceKind.session, ApiResourceKind.file]) {
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
      });
      const error = await refusal(mount("run_01m", auth.mintRunCredential("run_01m"), { store }));
      expect(error.code, ApiResourceKind[kind]).toBe(Code.Internal);
    }
  });

  it("refuses everyone but the run's runner with the one PERMISSION_DENIED", async () => {
    await seedSession([]);
    await seedRun("run_01m", SESSION);
    await seedRun("run_01other", SESSION);
    for (const token of ["", "garbage", auth.mintRunCredential("run_01other")]) {
      const error = await refusal(mount("run_01m", token));
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(NOT_THE_RUNS_RUNNER_MOUNT_MESSAGE);
    }
    const nobody = await refusal(mount("run_01nobody", auth.mintRunCredential("run_01nobody")));
    expect(nobody.code).toBe(Code.PermissionDenied);
    const composed: RunnerCredentialProvider = { ...credentials, authorizeRunnerForRun: async () => false };
    const refused = await refusal(mount("run_01m", auth.mintRunCredential("run_01m"), { runnerAuth: composed }));
    expect(refused.code).toBe(Code.PermissionDenied);
  });

  it("refuses a finished run, a run_id left out, and a conversation that is gone", async () => {
    await seedRun("run_01done", SESSION, RunPhase.RUN_COMPLETED);
    expect((await refusal(mount("run_01done", auth.mintRunCredential("run_01done")))).code).toBe(Code.FailedPrecondition);
    expect((await refusal(mount("", "x"))).code).toBe(Code.InvalidArgument);
    await seedRun("run_01orphan", "ses_01gonegonegonegonegonego");
    expect((await refusal(mount("run_01orphan", auth.mintRunCredential("run_01orphan")))).code).toBe(
      Code.FailedPrecondition,
    );
  });
});
