/**
 * Pins the agent's archive step (SaveVersionAudit, the agent's binding of
 * the shared archive in versions.ts) at its safe-degradation arms, over a
 * store stand-in; the composed suite cannot make the real store fail
 * selectively. The step runs after the chain's write, so every change it
 * makes to the head reaches the stored row through a narrow write onto the
 * live row, taken only while that row still holds this version:
 *
 *   - an archive failure clears status.version_hash and metadata.version.id,
 *     on the answer and on the live row, so the agent never names a version
 *     nobody can read, and assigns no tag;
 *   - a tag failure clears the live metadata.version.tag the same way, so
 *     the agent never advertises a tag the history cannot resolve;
 *   - a revert never undoes a write that landed after this one: a live row
 *     already holding another version is left as it is;
 *   - a write naming no tag onto an already-archived version shows the tag
 *     that version holds, on the answer and on the live row, and assigns
 *     none (a tag moved since the write loaded the row stays moved); a
 *     failed read of it leaves the head untagged.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { AuditNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { newSaveAgentVersionStep } from "../versions.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const HASH = "e".repeat(64);

/** The live row the stand-in store holds, and how many narrow writes reached it. */
interface Live {
  row: Agent;
  writes: number;
}

function agentAt(hash: string, tag: string): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_1", org: "acme", version: { id: hash, tag } },
    status: { versionHash: hash },
  });
}

/** The narrow write the step makes onto the live row, as the store's atomic write applies it. */
function liveRowWrites(live: Live) {
  return {
    async updateResource(
      _kind: unknown,
      _id: unknown,
      _schema: unknown,
      modify: (agent: Agent) => void,
    ): Promise<Agent> {
      live.writes += 1;
      modify(live.row);
      return live.row;
    },
  };
}

function failingStore(
  fail: { archive?: boolean; tag?: boolean },
  live: Live,
): { store: Store; tagCalls: () => number } {
  let tagCalls = 0;
  const store = {
    ...liveRowWrites(live),
    async getAuditByHash(): Promise<never> {
      throw new AuditNotFoundError("not archived");
    },
    async saveAudit(): Promise<void> {
      if (fail.archive === true) throw new Error("disk full");
    },
    async setAuditTag(): Promise<void> {
      tagCalls += 1;
      if (fail.tag === true) throw new Error("tag column locked");
    },
  } as unknown as Store;
  return { store, tagCalls: () => tagCalls };
}

function contextWithAgent(): RequestContext<typeof AgentSchema> {
  return new RequestContext(
    AgentSchema,
    agentAt(HASH, "stable"),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
}

describe("the agent's SaveVersionAudit — safe degradation", () => {
  it("an archive failure clears the hash and version id on the answer and the live row, and assigns no tag", async () => {
    const live: Live = { row: agentAt(HASH, "stable"), writes: 0 };
    const { store, tagCalls } = failingStore({ archive: true }, live);
    const ctx = contextWithAgent();

    await newSaveAgentVersionStep(store, silentLogger).execute(ctx);

    expect(ctx.newState.status?.versionHash).toBe("");
    expect(ctx.newState.metadata?.version?.id).toBe("");
    expect(tagCalls()).toBe(0);
    expect(live.row.status?.versionHash).toBe("");
    expect(live.row.metadata?.version?.id).toBe("");
    expect(live.row.metadata?.version?.tag).toBe("stable");
  });

  it("a tag failure clears the tag on the answer and the live row", async () => {
    const live: Live = { row: agentAt(HASH, "stable"), writes: 0 };
    const { store } = failingStore({ tag: true }, live);
    const ctx = contextWithAgent();

    await newSaveAgentVersionStep(store, silentLogger).execute(ctx);

    expect(ctx.newState.metadata?.version?.tag).toBe("");
    expect(ctx.newState.status?.versionHash).toBe(HASH);
    expect(live.row.metadata?.version?.tag).toBe("");
    expect(live.row.status?.versionHash).toBe(HASH);
  });

  it("a revert leaves a live row that already holds a later version as it is", async () => {
    const later = "f".repeat(64);
    const live: Live = { row: agentAt(later, "next"), writes: 0 };
    const { store } = failingStore({ archive: true }, live);
    const ctx = contextWithAgent();

    await newSaveAgentVersionStep(store, silentLogger).execute(ctx);

    expect(ctx.newState.status?.versionHash).toBe("");
    expect(live.row.status?.versionHash).toBe(later);
    expect(live.row.metadata?.version?.id).toBe(later);
    expect(live.row.metadata?.version?.tag).toBe("next");
  });
});

describe("the agent's SaveVersionAudit — a version already archived, no tag named", () => {
  function archivedStore(
    read: () => Promise<{ tag: string }>,
    live: Live,
  ): { store: Store; tagWrites: () => number } {
    let tagWrites = 0;
    const store = {
      ...liveRowWrites(live),
      async getAuditByHash(): Promise<Agent> {
        return create(AgentSchema, {});
      },
      async getAuditRecordByHash(): Promise<{ tag: string }> {
        return read();
      },
      async setAuditTag(): Promise<void> {
        tagWrites += 1;
      },
    } as unknown as Store;
    return { store, tagWrites: () => tagWrites };
  }

  function untaggedWrite(): RequestContext<typeof AgentSchema> {
    return new RequestContext(
      AgentSchema,
      agentAt(HASH, ""),
      testCallerIdentity(),
      ApiResourceKind.agent,
    );
  }

  it("shows the tag the version holds on the answer and the live row, and assigns none", async () => {
    const live: Live = { row: agentAt(HASH, ""), writes: 0 };
    const { store, tagWrites } = archivedStore(async () => ({ tag: "stable" }), live);
    const ctx = untaggedWrite();

    await newSaveAgentVersionStep(store, silentLogger).execute(ctx);

    expect(ctx.newState.metadata?.version?.tag).toBe("stable");
    expect(live.row.metadata?.version?.tag).toBe("stable");
    expect(tagWrites()).toBe(0);
  });

  it("leaves the head untagged when the tag cannot be read", async () => {
    const live: Live = { row: agentAt(HASH, ""), writes: 0 };
    const { store } = archivedStore(async () => {
      throw new Error("store is down");
    }, live);
    const ctx = untaggedWrite();

    await newSaveAgentVersionStep(store, silentLogger).execute(ctx);

    expect(ctx.newState.metadata?.version?.tag).toBe("");
    expect(live.writes).toBe(0);
  });
});
