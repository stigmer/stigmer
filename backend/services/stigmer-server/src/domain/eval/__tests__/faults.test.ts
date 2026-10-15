/**
 * Pins the eval controller's fault answers, which the composed suites
 * cannot reach because their store, archive store and transfer lane all
 * work: an eval served on an in-process router over a real store that one
 * composed push filled, with the archive store, the staging port and the
 * row writes made to fail on demand.
 *
 *   - no transfer lane: the upload mint and the download URL answer
 *     FailedPrecondition with the lane's copy;
 *   - an archive the store no longer holds is NotFound naming the version,
 *     any other store fault a sanitized Internal, on both downloads;
 *   - a lane that cannot mint an upload or a download URL is an Internal;
 *   - the visibility update's load and write: a row gone is NotFound, any
 *     other fault an Internal.
 *
 * And the version step's degradations (ArchiveCurrentEval): an archive
 * write that fails clears the head's digest, a tag the store cannot assign
 * is cleared from the head, and a push naming no tag onto an archived
 * version shows the tag it holds.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EvalSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import type { Eval } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import { EvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/command_pb";
import { PushEvalRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import { EvalQueryController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { ArtifactNotFoundError } from "../../../archive/content-store.js";
import type { ContentAddressedArchiveStore } from "../../../archive/content-store.js";
import { UNBOUND_CREDENTIAL_BINDING } from "../../../authorization/__tests__/unbound-credential-binding.js";
import { writeArchive } from "../../../archive/write.js";
import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import { errorOf, testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_PUSHED_RESOURCE_KEY, PUSHED_RESOURCE_KEY } from "../../../pipeline/steps/archive-push.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { AuditNotFoundError, ResourceNotFoundError } from "../../../store/interface.js";
import type { AuditRecord, Store } from "../../../store/interface.js";
import { organizationId, seedOrganizations } from "../../organization/__tests__/support.js";
import type { ArchiveStaging } from "../../skill/transfer/staging.js";
import { EVAL_TRANSFER_LANE_NOT_CONFIGURED } from "../constants.js";
import { registerEvalServices } from "../controller.js";
import { newArchiveCurrentEvalStep } from "../push.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const ORG = "acme";
const SLUG = "faulty";
const encoder = new TextEncoder();
const JUDGE = "---\ntype: llm\n---\n\nPASS if the reply answers.\n";

let dir: string;
let server: ComposedServer;
let evalId: string;
// The router below has no organization-name interceptor: requests name the organization by id.
let orgId: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "eval-faults-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STORAGE_PATH: path.join(dir, "storage"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  orgId = organizationId(await seedOrganizations(transport, [ORG]), ORG);
  const pushed = await createClient(EvalCommandController, transport).push({
    org: ORG,
    slug: SLUG,
    artifact: writeArchive([
      { path: "c/prompt.md", bytes: encoder.encode("Hi.") },
      { path: "c/graders/judge.md", bytes: encoder.encode(JUDGE) },
    ]),
  });
  evalId = pushed.metadata!.id;
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

/** An archive store whose reads fail with `fault`. */
function archivesFailing(fault: () => Error): ContentAddressedArchiveStore {
  return {
    store: () => Promise.reject(fault()),
    get: () => Promise.reject(fault()),
    exists: () => Promise.reject(fault()),
    size: () => Promise.reject(fault()),
    getStorageKey: (hash) => `evals/${hash}.zip`,
  };
}

/** An archive store that holds every digest, one byte each. */
const archivesPresent: ContentAddressedArchiveStore = {
  store: (hash) => Promise.resolve(`evals/${hash}.zip`),
  get: () => Promise.resolve(new Uint8Array([1])),
  exists: () => Promise.resolve(true),
  size: () => Promise.resolve(1),
  getStorageKey: (hash) => `evals/${hash}.zip`,
};

const failingLane: ArchiveStaging = {
  mint: () => Promise.reject(new Error("bucket unreachable")),
  consume: () => Promise.reject(new Error("not used")),
  downloadUrl: () => Promise.reject(new Error("bucket unreachable")),
};

interface Served {
  readonly command: Client<typeof EvalCommandController>;
  readonly query: Client<typeof EvalQueryController>;
}

function served(options: { store?: Store; archives?: ContentAddressedArchiveStore; staging?: ArchiveStaging }): Served {
  const transport = createRouterTransport(
    (router) => {
      registerEvalServices(router, {
        store: options.store ?? server.store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        listReadScope: undefined,
        artifactStorage: options.archives ?? archivesPresent,
        credentialBinding: UNBOUND_CREDENTIAL_BINDING,
        ...(options.staging !== undefined ? { staging: options.staging } : {}),
      });
    },
    {
      router: {
        interceptors: [createVerifierChainInterceptor([], [], silentLogger), createApiResourceInterceptor()],
      },
    },
  );
  return { command: createClient(EvalCommandController, transport), query: createClient(EvalQueryController, transport) };
}

/** The real store with the eval kind's row read or write made to throw `fault`. */
function storeFailing(method: "getResource" | "updateResource", fault: () => Error): Store {
  return new Proxy(server.store, {
    get(target, prop, receiver) {
      if (prop === method) {
        return (kind: ApiResourceKind, ...rest: unknown[]) =>
          kind === ApiResourceKind.eval
            ? Promise.reject(fault())
            : (Reflect.get(target, prop, receiver) as (...args: unknown[]) => unknown).call(target, kind, ...rest);
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

const ref = (): { org: string; slug: string; kind: ApiResourceKind } => ({ org: orgId, slug: SLUG, kind: ApiResourceKind.eval });

describe("the eval controller under faults", () => {
  it("answers FailedPrecondition for the upload mint and the download URL when there is no transfer lane", async () => {
    const { command, query } = served({});
    const mint = await errorOf(() => command.createArtifactUploadUrl({ org: orgId, slug: SLUG, sizeBytes: 10n }));
    expect(mint.code).toBe(Code.FailedPrecondition);
    expect(mint.rawMessage).toBe(EVAL_TRANSFER_LANE_NOT_CONFIGURED);
    const url = await errorOf(() => query.getDownloadUrl(ref()));
    expect(url.code).toBe(Code.FailedPrecondition);
  });

  it("answers a missing archive as NotFound and any other archive fault as Internal, on both downloads", async () => {
    const missing = served({ archives: archivesFailing(() => new ArtifactNotFoundError("evals/x.zip")), staging: failingLane });
    expect((await errorOf(() => missing.query.download(ref()))).code).toBe(Code.NotFound);
    expect((await errorOf(() => missing.query.getDownloadUrl(ref()))).code).toBe(Code.NotFound);
    const broken = served({ archives: archivesFailing(() => new Error("EIO")), staging: failingLane });
    expect((await errorOf(() => broken.query.download(ref()))).code).toBe(Code.Internal);
    expect((await errorOf(() => broken.query.getDownloadUrl(ref()))).code).toBe(Code.Internal);
  });

  it("answers a lane that cannot mint an upload or a download URL as Internal", async () => {
    const { command, query } = served({ staging: failingLane });
    expect((await errorOf(() => command.createArtifactUploadUrl({ org: orgId, slug: SLUG, sizeBytes: 10n }))).code).toBe(
      Code.Internal,
    );
    expect((await errorOf(() => query.getDownloadUrl(ref()))).code).toBe(Code.Internal);
  });

  it("answers the visibility update's load and write faults: a row gone NotFound, any other Internal", async () => {
    const level = { resourceId: evalId, visibility: ApiResourceVisibility.visibility_private };
    const goneOnLoad = served({ store: storeFailing("getResource", () => new ResourceNotFoundError("eval")) });
    expect((await errorOf(() => goneOnLoad.command.updateVisibility(level))).code).toBe(Code.NotFound);
    const brokenOnLoad = served({ store: storeFailing("getResource", () => new Error("db down")) });
    expect((await errorOf(() => brokenOnLoad.command.updateVisibility(level))).code).toBe(Code.Internal);
    const goneOnWrite = served({ store: storeFailing("updateResource", () => new ResourceNotFoundError("eval")) });
    expect((await errorOf(() => goneOnWrite.command.updateVisibility(level))).code).toBe(Code.NotFound);
    const brokenOnWrite = served({ store: storeFailing("updateResource", () => new Error("db down")) });
    expect((await errorOf(() => brokenOnWrite.command.updateVisibility(level))).code).toBe(Code.Internal);
  });
});

describe("ArchiveCurrentEval's degradations", () => {
  const DIGEST = "e".repeat(64);

  function headCtx(tag: string): { ctx: RequestContext<typeof PushEvalRequestSchema>; head: Eval } {
    const head = create(EvalSchema, {
      metadata: { id: "evs_01degrade", org: "org_acme", slug: "degrade", version: { id: DIGEST } },
      spec: { tag },
      status: { digest: DIGEST },
    });
    const ctx = new RequestContext(
      PushEvalRequestSchema,
      create(PushEvalRequestSchema, {}),
      testCallerIdentity(),
      ApiResourceKind.eval,
    );
    ctx.set(PUSHED_RESOURCE_KEY, head);
    ctx.set(EXISTING_PUSHED_RESOURCE_KEY, undefined);
    return { ctx, head };
  }

  /** A store of the version operations alone, each answering as given. */
  function versions(answers: {
    archived: boolean;
    saveAudit?: () => Promise<void>;
    setAuditTag?: () => Promise<void>;
    recordTag?: string;
  }): Store {
    return {
      getAuditByHash: () => (answers.archived ? Promise.resolve(create(EvalSchema)) : Promise.reject(new AuditNotFoundError("none"))),
      saveAudit: answers.saveAudit ?? (() => Promise.resolve()),
      setAuditTag: answers.setAuditTag ?? (() => Promise.resolve()),
      getAuditRecordByHash: () => Promise.resolve({ tag: answers.recordTag ?? "" } as AuditRecord),
      updateResource: () => Promise.resolve(create(EvalSchema)),
    } as unknown as Store;
  }

  it("clears the head's digest when its version cannot be archived", async () => {
    const { ctx, head } = headCtx("stable");
    await newArchiveCurrentEvalStep(versions({ archived: false, saveAudit: () => Promise.reject(new Error("full")) }), silentLogger).execute(ctx);
    expect(head.status?.digest).toBe("");
    expect(head.metadata?.version?.id).toBe("");
  });

  it("clears the head's tag when the store cannot assign it", async () => {
    const { ctx, head } = headCtx("stable");
    await newArchiveCurrentEvalStep(versions({ archived: false, setAuditTag: () => Promise.reject(new Error("locked")) }), silentLogger).execute(ctx);
    expect(head.spec?.tag).toBe("");
    expect(head.status?.digest).toBe(DIGEST);
  });

  it("shows the tag an archived version holds when the push named none", async () => {
    const { ctx, head } = headCtx("");
    await newArchiveCurrentEvalStep(versions({ archived: true, recordTag: "stable" }), silentLogger).execute(ctx);
    expect(head.spec?.tag).toBe("stable");
  });
});
