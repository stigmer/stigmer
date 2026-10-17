/**
 * Pins the shared push steps' arms the composed suites cannot reach, over
 * ports that fail on demand: the slug lookup's store faults are a
 * sanitized Internal, and a row the name points at but the store no longer
 * holds is a create; the content store's faults are an Internal naming the
 * act; and the tuple splice fires the creation event on a create (none for
 * a kind with no authorization), diffs the level on a re-push (nothing when
 * it did not move), and answers a lifecycle fault as an Internal. The
 * plugin's and the eval's composed suites prove the arms that a real store
 * and a real lifecycle take.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { EvalSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import type { Eval } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import { PushEvalRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import type { ContentAddressedArchiveStore } from "../../../archive/content-store.js";
import { createLogger } from "../../../boot/logger.js";
import type {
  ResourceAuthorizationLifecycle,
  ResourceCreatedEvent,
  VisibilityChangedEvent,
} from "../../../extensions/resource-authorization.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { ResourceNameEntry, Store } from "../../../store/interface.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import {
  ARTIFACT_STORAGE_KEY_KEY,
  EXISTING_PUSHED_RESOURCE_KEY,
  OPENED_ARCHIVE_KEY,
  PUSHED_RESOURCE_KEY,
  RENAMED_AWAY_ID_KEY,
  SHOULD_CREATE_KEY,
  newCheckAndStoreArtifactStep,
  newFindExistingBySlugStep,
  newPushAuthorizationTuplesStep,
  newRefuseRenamedSlugStep,
} from "../archive-push.js";
import { ARTIFACT_BYTES_KEY } from "../resolve-artifact-source.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const DIGEST = "d".repeat(64);
const binding = { schema: EvalSchema, noun: "eval" };

function headAt(visibility: ApiResourceVisibility): Eval {
  return create(EvalSchema, {
    metadata: { id: "evs_01head", org: "org_acme", slug: "support", visibility },
  });
}

function ctxFor(kind: ApiResourceKind = ApiResourceKind.eval): RequestContext<typeof PushEvalRequestSchema> {
  const ctx = new RequestContext(
    PushEvalRequestSchema,
    create(PushEvalRequestSchema, { org: "org_acme", slug: "support" }),
    testCallerIdentity(),
    kind,
  );
  ctx.set(PUSHED_RESOURCE_KEY, headAt(ApiResourceVisibility.visibility_org));
  return ctx;
}

/** A store whose name table answers `resolve`, and whose row read answers `read`. */
function storeWith(resolve: () => Promise<ResourceNameEntry | undefined>, read: () => Promise<unknown>): Store {
  return {
    resourceNames: { resolve },
    readResourceForWrite: read,
  } as unknown as Store;
}

function entry(state: "current" | "previous"): ResourceNameEntry {
  return { kind: "eval", org: "org_acme", name: "support", id: "evs_01stored", state, claimedAt: "", expiresAt: "" };
}

async function connectErrorOf(run: () => unknown): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected the step to fail");
}

describe("FindExistingBySlug", () => {
  it("answers a name-table fault as an Internal", async () => {
    const step = newFindExistingBySlugStep(storeWith(() => Promise.reject(new Error("db down")), () => Promise.resolve(undefined)), binding);
    const error = await connectErrorOf(() => step.execute(ctxFor()));
    expect(error.code).toBe(Code.Internal);
  });

  it("answers a row-read fault as an Internal, and a row gone since the name as a create", async () => {
    const faulty = newFindExistingBySlugStep(
      storeWith(() => Promise.resolve(entry("current")), () => Promise.reject(new Error("disk"))),
      binding,
    );
    expect((await connectErrorOf(() => faulty.execute(ctxFor()))).code).toBe(Code.Internal);

    const gone = newFindExistingBySlugStep(
      storeWith(() => Promise.resolve(entry("current")), () => Promise.reject(new ResourceNotFoundError("eval evs_01stored"))),
      binding,
    );
    const ctx = ctxFor();
    await gone.execute(ctx);
    expect(ctx.get(SHOULD_CREATE_KEY)).toBe(true);
  });

  it("records a renamed-away slug without refusing it, for RefuseRenamedSlug to refuse after authorization", async () => {
    const step = newFindExistingBySlugStep(
      storeWith(() => Promise.resolve(entry("previous")), () => Promise.reject(new Error("never read"))),
      binding,
    );
    const ctx = ctxFor();
    await step.execute(ctx);
    expect(ctx.get(RENAMED_AWAY_ID_KEY)).toBe("evs_01stored");
    const refused = await connectErrorOf(() => newRefuseRenamedSlugStep().execute(ctx));
    expect(refused.code).toBe(Code.FailedPrecondition);
  });
});

describe("CheckAndStoreArtifact", () => {
  function archives(exists: () => Promise<boolean>, store: () => Promise<string>): ContentAddressedArchiveStore {
    return {
      exists,
      store,
      get: () => Promise.reject(new Error("not read")),
      size: () => Promise.reject(new Error("not read")),
      getStorageKey: (hash) => `evals/${hash}.zip`,
    };
  }

  function archiveCtx(): RequestContext<typeof PushEvalRequestSchema> {
    const ctx = ctxFor();
    ctx.set(ARTIFACT_BYTES_KEY, new Uint8Array([1]));
    ctx.set(OPENED_ARCHIVE_KEY, { digest: DIGEST, files: { entries: [], read: () => new Uint8Array() } });
    return ctx;
  }

  it("answers an existence check fault and a store fault as an Internal naming the act", async () => {
    const checking = newCheckAndStoreArtifactStep<typeof PushEvalRequestSchema>(
      archives(() => Promise.reject(new Error("io")), () => Promise.resolve("")),
    );
    const checkError = await connectErrorOf(() => checking.execute(archiveCtx()));
    expect(checkError.code).toBe(Code.Internal);
    expect(checkError.rawMessage).toContain("failed to check artifact existence");

    const storing = newCheckAndStoreArtifactStep<typeof PushEvalRequestSchema>(
      archives(() => Promise.resolve(false), () => Promise.reject(new Error("full"))),
    );
    const storeError = await connectErrorOf(() => storing.execute(archiveCtx()));
    expect(storeError.rawMessage).toContain("failed to store artifact");
  });

  it("reuses the stored copy of a digest it already holds", async () => {
    const step = newCheckAndStoreArtifactStep<typeof PushEvalRequestSchema>(
      archives(() => Promise.resolve(true), () => Promise.reject(new Error("never written"))),
    );
    const ctx = archiveCtx();
    await step.execute(ctx);
    expect(ctx.get(ARTIFACT_STORAGE_KEY_KEY)).toBe(`evals/${DIGEST}.zip`);
  });
});

describe("PushAuthorizationTuples", () => {
  function lifecycle(fail = false): {
    readonly port: ResourceAuthorizationLifecycle;
    readonly created: ResourceCreatedEvent[];
    readonly changed: VisibilityChangedEvent[];
  } {
    const created: ResourceCreatedEvent[] = [];
    const changed: VisibilityChangedEvent[] = [];
    const port: ResourceAuthorizationLifecycle = {
      onResourceCreated: (event) => (fail ? Promise.reject(new Error("fga down")) : (created.push(event), Promise.resolve())),
      onResourceDeleted: () => Promise.resolve(),
      onVisibilityChanged: (event) => (fail ? Promise.reject(new Error("fga down")) : (changed.push(event), Promise.resolve())),
    };
    return { port, created, changed };
  }

  const step = (port: ResourceAuthorizationLifecycle) =>
    newPushAuthorizationTuplesStep<typeof EvalSchema, typeof PushEvalRequestSchema>(port, silentLogger, "EvalPushAuthorizationTuples");

  it("fires the creation event on a create, and none for a kind with no authorization", async () => {
    const { port, created } = lifecycle();
    const ctx = ctxFor();
    ctx.set(SHOULD_CREATE_KEY, true);
    await step(port).execute(ctx);
    expect(created.map((event) => event.resourceId)).toEqual(["evs_01head"]);

    const unscoped = ctxFor(ApiResourceKind.plan);
    unscoped.set(SHOULD_CREATE_KEY, true);
    await step(port).execute(unscoped);
    expect(created).toHaveLength(1);
  });

  it("moves the level's tuples on a re-push that moved it, and writes nothing when it did not", async () => {
    const { port, changed } = lifecycle();
    const same = ctxFor();
    same.set(SHOULD_CREATE_KEY, false);
    same.set(EXISTING_PUSHED_RESOURCE_KEY, headAt(ApiResourceVisibility.visibility_org));
    await step(port).execute(same);
    expect(changed).toEqual([]);

    const moved = ctxFor();
    moved.set(SHOULD_CREATE_KEY, false);
    moved.set(EXISTING_PUSHED_RESOURCE_KEY, headAt(ApiResourceVisibility.visibility_private));
    await step(port).execute(moved);
    expect(changed.map((event) => event.resourceId)).toEqual(["evs_01head"]);
  });

  it("answers a lifecycle fault as an Internal on either arm", async () => {
    const { port } = lifecycle(true);
    const creating = ctxFor();
    creating.set(SHOULD_CREATE_KEY, true);
    expect((await connectErrorOf(() => step(port).execute(creating))).rawMessage).toContain(
      "failed to create authorization tuples",
    );
    const moving = ctxFor();
    moving.set(SHOULD_CREATE_KEY, false);
    moving.set(EXISTING_PUSHED_RESOURCE_KEY, headAt(ApiResourceVisibility.visibility_private));
    expect((await connectErrorOf(() => step(port).execute(moving))).rawMessage).toContain(
      "failed to update visibility tuples",
    );
  });
});
