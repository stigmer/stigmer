/**
 * Pins how the shared version steps (version-history.ts, version-archive.ts)
 * answer a store that is missing a row or failing, at step level over a
 * store stand-in exposing only the members each step touches; the composed
 * suites cannot make the real store fail selectively.
 *
 *   - getVersionEntry: a missing resource and a missing version are NotFound,
 *     naming which; a failing read of either is Internal; the head answers
 *     itself as current, and an archived version carries the audit column's
 *     tag written on;
 *   - resolveVersionHash: a version the resource does not hold is undefined,
 *     a failing audit read Internal;
 *   - the getByReference ladder: a reference with no slug is
 *     InvalidArgument before the store is read; a failing audit query and
 *     an undecodable audit row are Internal, never a NotFound;
 *   - the tag move: a missing resource is NotFound; a failing tag write or
 *     head reconcile is Internal; the head's tag reconciles to "" when the
 *     head has no hash or no audit row, and a failing head-tag read is
 *     Internal;
 *   - the version-metadata rule leaves a head with no hash or no metadata as
 *     it is, and on an unchanged hash keeps the stored id and chain;
 *   - a version page whose head hash no audit row holds marks no version
 *     current, and a failing read of the current record is Internal.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import {
  ListAgentVersionsInputSchema,
  TagAgentVersionInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import type { ListAgentVersionsResponse } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import { agentVersionBinding } from "../../../domain/agent/versions.js";
import { RequestContext } from "../../request-context.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import {
  AuditNotFoundError,
  ResourceNotFoundError,
} from "../../../store/interface.js";
import type { AuditRecord, Store } from "../../../store/interface.js";
import { EXISTING_RESOURCE_KEY } from "../load-existing.js";
import { VERSION_HASH_KEY, newPopulateVersionStep } from "../version-archive.js";
import {
  LIST_VERSIONS_HEAD_HASH_KEY,
  LIST_VERSIONS_RESOURCE_ID_KEY,
  LIST_VERSIONS_RESPONSE_KEY,
  getVersionEntry,
  newLoadAndMapVersionsStep,
  newLoadByReferenceWithVersionStep,
  loadByReferenceWithVersion,
  newLoadForTagVersionStep,
  newTagVersionStep,
  resolveVersionHash,
} from "../version-history.js";
import type { VersionTagBinding } from "../version-history.js";

const HEAD = "a".repeat(64);
const OLD = "b".repeat(64);
const STORE_DOWN = new Error("store is down");

function agent(hash: string, tag = ""): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: "acme", slug: "reviewer", version: { tag } },
    spec: { instructions: `Instructions at ${hash.slice(0, 4)}.` },
    status: { versionHash: hash },
  });
}

function record(hash: string, tag: string): AuditRecord {
  return {
    data: toBinary(AgentSchema, agent(hash, "archived-with")),
    versionHash: hash,
    tag,
  } as unknown as AuditRecord;
}

/** A store exposing only what a step touches; every member may be overridden. */
function storeWith(members: Record<string, unknown>): Store {
  return members as unknown as Store;
}

async function failureOf(run: Promise<unknown>): Promise<ConnectError> {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

describe("getVersionEntry", () => {
  const lookup = { resourceId: "agt_1", versionHash: OLD };

  it("answers the head as current with its live tag", async () => {
    const store = storeWith({ getResource: async () => agent(HEAD, "stable") });
    const entry = await getVersionEntry(store, agentVersionBinding, {
      resourceId: "agt_1",
      versionHash: HEAD,
    });
    expect(entry.isCurrent).toBe(true);
    expect(entry.tag).toBe("stable");
  });

  it("answers an archived version with the audit column's tag", async () => {
    const store = storeWith({
      getResource: async () => agent(HEAD),
      getAuditRecordByHash: async () => record(OLD, "prod"),
    });
    const entry = await getVersionEntry(store, agentVersionBinding, lookup);
    expect(entry.isCurrent).toBe(false);
    expect(entry.tag).toBe("prod");
    expect(entry.specSnapshot?.instructions).toBe("Instructions at bbbb.");
  });

  it("is NotFound for a missing resource and Internal for a failing read of it", async () => {
    let error = await failureOf(
      getVersionEntry(
        storeWith({ getResource: async () => Promise.reject(new ResourceNotFoundError("agent agt_1")) }),
        agentVersionBinding,
        lookup,
      ),
    );
    expect(error.code).toBe(Code.NotFound);
    error = await failureOf(
      getVersionEntry(storeWith({ getResource: async () => Promise.reject(STORE_DOWN) }), agentVersionBinding, lookup),
    );
    expect(error.code).toBe(Code.Internal);
  });

  it("is NotFound naming the short hash for a missing version, Internal for a failing audit read", async () => {
    let error = await failureOf(
      getVersionEntry(
        storeWith({
          getResource: async () => agent(HEAD),
          getAuditRecordByHash: async () => Promise.reject(new AuditNotFoundError("none")),
        }),
        agentVersionBinding,
        lookup,
      ),
    );
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toContain("bbbbbbbbbbbb...");
    error = await failureOf(
      getVersionEntry(
        storeWith({ getResource: async () => agent(HEAD), getAuditRecordByHash: async () => Promise.reject(STORE_DOWN) }),
        agentVersionBinding,
        lookup,
      ),
    );
    expect(error.code).toBe(Code.Internal);
  });
});

describe("resolveVersionHash", () => {
  it("answers the archived row's hash, undefined for a version the resource does not hold, Internal for a failing read", async () => {
    expect(
      await resolveVersionHash(storeWith({ getAuditRecordByTag: async () => record(OLD, "v1") }), agentVersionBinding, agent(HEAD), "v1"),
    ).toBe(OLD);
    expect(
      await resolveVersionHash(
        storeWith({ getAuditRecordByHash: async () => Promise.reject(new AuditNotFoundError("none")) }),
        agentVersionBinding,
        agent(HEAD),
        OLD,
      ),
    ).toBeUndefined();
    const error = await failureOf(
      resolveVersionHash(storeWith({ getAuditRecordByTag: async () => Promise.reject(STORE_DOWN) }), agentVersionBinding, agent(HEAD), "v1"),
    );
    expect(error.code).toBe(Code.Internal);
  });
});

describe("the getByReference ladder", () => {
  function ladderContext(): RequestContext<typeof ApiResourceReferenceSchema> {
    return new RequestContext(
      ApiResourceReferenceSchema,
      create(ApiResourceReferenceSchema, { org: "acme", slug: "reviewer", version: OLD }),
      testCallerIdentity(),
      ApiResourceKind.agent,
    );
  }
  const listed = async () => [toBinary(AgentSchema, agent(HEAD))];

  it("is InvalidArgument for a reference with neither slug nor id, before the store is read", async () => {
    const error = await failureOf(
      loadByReferenceWithVersion(
        storeWith({}),
        agentVersionBinding,
        create(ApiResourceReferenceSchema, { org: "acme", slug: "", version: OLD }),
      ),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("slug or id is required in reference");
  });

  it("is Internal, never NotFound, for a failing read of the head a reference names by id", async () => {
    const error = await failureOf(
      loadByReferenceWithVersion(
        storeWith({ getResource: async () => Promise.reject(STORE_DOWN) }),
        agentVersionBinding,
        create(ApiResourceReferenceSchema, { org: "acme", id: "agt_1", version: OLD }),
      ),
    );
    expect(error.code).toBe(Code.Internal);
  });

  it("is Internal for a failing audit query", async () => {
    const step = newLoadByReferenceWithVersionStep(
      storeWith({ listResources: listed, getAuditRecordByHash: async () => Promise.reject(STORE_DOWN) }),
      agentVersionBinding,
      "LoadAgentByReference",
    );
    expect((await failureOf(Promise.resolve(step.execute(ladderContext())))).code).toBe(Code.Internal);
  });

  it("is Internal for an audit row that does not decode", async () => {
    const step = newLoadByReferenceWithVersionStep(
      storeWith({
        listResources: listed,
        getAuditRecordByHash: async () => ({ data: new Uint8Array([0xff, 0xff, 0xff]), tag: "" }),
      }),
      agentVersionBinding,
      "LoadAgentByReference",
    );
    expect((await failureOf(Promise.resolve(step.execute(ladderContext())))).code).toBe(Code.Internal);
  });
});

describe("the tag move", () => {
  const binding: VersionTagBinding<typeof AgentSchema, typeof TagAgentVersionInputSchema> = {
    ...agentVersionBinding,
    overlayTag: agentVersionBinding.overlayTag!,
    tagInput: (req) => ({ resourceId: req.agentId, versionHash: req.versionHash, tag: req.tag }),
  };

  function tagContext(): RequestContext<typeof TagAgentVersionInputSchema> {
    return new RequestContext(
      TagAgentVersionInputSchema,
      create(TagAgentVersionInputSchema, { agentId: "agt_1", versionHash: OLD, tag: "stable" }),
      testCallerIdentity(),
      ApiResourceKind.agent,
    );
  }

  async function move(head: Agent, members: Record<string, unknown>): Promise<Agent> {
    const ctx = tagContext();
    ctx.set("head", head);
    const updated: Agent[] = [];
    await newTagVersionStep(
      storeWith({
        setAuditTag: async () => undefined,
        updateResource: async (_k: unknown, _id: unknown, _s: unknown, modify: (a: Agent) => void) => {
          const copy = agent(head.status?.versionHash ?? "", "before");
          modify(copy);
          updated.push(copy);
          return copy;
        },
        ...members,
      }),
      binding,
      "TagAgentVersion",
      "head",
      "result",
    ).execute(ctx);
    return updated[0]!;
  }

  it("is NotFound for a missing resource and Internal for a failing load", async () => {
    const load = (getResource: () => Promise<Agent>) =>
      Promise.resolve(
        newLoadForTagVersionStep(storeWith({ getResource }), binding, "LoadAgentForTagVersion", "head").execute(
          tagContext(),
        ),
      );
    expect((await failureOf(load(async () => Promise.reject(new ResourceNotFoundError("agent agt_1"))))).code).toBe(
      Code.NotFound,
    );
    expect((await failureOf(load(async () => Promise.reject(STORE_DOWN)))).code).toBe(Code.Internal);
  });

  it("is Internal for a failing tag write and a failing head reconcile", async () => {
    expect((await failureOf(move(agent(HEAD), { setAuditTag: async () => Promise.reject(STORE_DOWN) }))).code).toBe(
      Code.Internal,
    );
    expect(
      (
        await failureOf(
          move(agent(HEAD), {
            getAuditRecordByHash: async () => record(HEAD, "stable"),
            updateResource: async () => Promise.reject(STORE_DOWN),
          }),
        )
      ).code,
    ).toBe(Code.Internal);
  });

  it("reconciles the head to no tag when it has no hash or no audit row, and is Internal when the read fails", async () => {
    expect((await move(agent(""), {})).metadata?.version?.tag).toBe("");
    expect(
      (await move(agent(HEAD), { getAuditRecordByHash: async () => Promise.reject(new AuditNotFoundError("none")) }))
        .metadata?.version?.tag,
    ).toBe("");
    expect(
      (await failureOf(move(agent(HEAD), { getAuditRecordByHash: async () => Promise.reject(STORE_DOWN) }))).code,
    ).toBe(Code.Internal);
  });
});

describe("the version-metadata rule", () => {
  const populate = newPopulateVersionStep<typeof AgentSchema>({
    headHashOf: (a) => a.status?.versionHash ?? "",
    setHeadHash: (a, hash) => {
      a.status!.versionHash = hash;
    },
  });

  it("on an unchanged hash keeps the stored id, chain and message, and moves a named tag", () => {
    const stored = create(AgentSchema, {
      metadata: { id: "agt_1", version: { id: HEAD, previousVersionId: OLD, message: "stored", tag: "old" } },
      status: { versionHash: HEAD },
    });
    const ctx = new RequestContext(
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_1", version: { id: "", message: "client", tag: "new" } },
        status: { versionHash: HEAD },
      }),
      testCallerIdentity(),
      ApiResourceKind.agent,
    );
    ctx.set(EXISTING_RESOURCE_KEY, stored);
    ctx.set(VERSION_HASH_KEY, HEAD);

    populate.execute(ctx);

    expect(ctx.newState.metadata?.version).toMatchObject({
      id: HEAD,
      previousVersionId: OLD,
      message: "stored",
      tag: "new",
    });
  });

  it("leaves a head with no computed hash, or with no metadata, as it is", () => {
    const noHash = new RequestContext(AgentSchema, agent(HEAD), testCallerIdentity(), ApiResourceKind.agent);
    populate.execute(noHash);
    expect(noHash.newState.status?.versionHash).toBe(HEAD);

    const bare = create(AgentSchema, { status: { versionHash: HEAD } });
    const noMetadata = new RequestContext(AgentSchema, bare, testCallerIdentity(), ApiResourceKind.agent);
    noMetadata.set(VERSION_HASH_KEY, OLD);
    populate.execute(noMetadata);
    expect(noMetadata.newState.status?.versionHash).toBe(HEAD);
  });
});

describe("a version page", () => {
  async function page(getAuditRecordByHash: () => Promise<AuditRecord>): Promise<ListAgentVersionsResponse> {
    const ctx = new RequestContext(
      ListAgentVersionsInputSchema,
      create(ListAgentVersionsInputSchema, { org: "acme", slug: "reviewer" }),
      testCallerIdentity(),
      ApiResourceKind.agent,
    );
    ctx.set(LIST_VERSIONS_RESOURCE_ID_KEY, "agt_1");
    ctx.set(LIST_VERSIONS_HEAD_HASH_KEY, HEAD);
    await newLoadAndMapVersionsStep(
      storeWith({
        listAuditRecordsPage: async () => [
          { ...record(OLD, ""), seq: "2" },
          { ...record(HEAD, ""), seq: "1" },
        ],
        getAuditRecordByHash,
      }),
      agentVersionBinding,
      "LoadAndMapAgentVersions",
    ).execute(ctx);
    return ctx.get(LIST_VERSIONS_RESPONSE_KEY) as ListAgentVersionsResponse;
  }

  it("marks no version current when no audit row holds the head's hash", async () => {
    const listed = await page(async () => Promise.reject(new AuditNotFoundError("none")));
    expect(listed.entries.map((entry) => entry.isCurrent)).toEqual([false, false]);
  });

  it("is Internal when the read of the current record fails", async () => {
    const failure = await failureOf(page(async () => Promise.reject(STORE_DOWN)));
    expect([failure.code, failure.rawMessage]).toEqual([Code.Internal, "failed to load version history"]);
  });
});
