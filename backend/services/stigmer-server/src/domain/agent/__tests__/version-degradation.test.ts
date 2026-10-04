/**
 * Pins the agent's archive step (SaveVersionAudit, the agent's binding of
 * the shared archive in versions.ts) at its safe-degradation arms, over a
 * store stand-in; the composed suite cannot make the real store fail
 * selectively:
 *
 *   - an archive failure clears status.version_hash and metadata.version.id,
 *     so the agent never names a version nobody can read, and assigns no tag;
 *   - a tag failure clears the live metadata.version.tag, so the agent never
 *     advertises a tag the history cannot resolve;
 *   - on create (no write follows the archive) either revert is re-persisted;
 *     on update the chain's own Persist writes it and the step writes nothing.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { AuditNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { newSaveAgentVersionStep } from "../versions.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const HASH = "e".repeat(64);

interface Persisted {
  versionHash: string;
  versionId: string;
  tag: string;
}

function failingStore(fail: { archive?: boolean; tag?: boolean }): {
  store: Store;
  persisted: Persisted[];
  tagCalls: () => number;
} {
  const persisted: Persisted[] = [];
  let tagCalls = 0;
  const store = {
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
    async saveResource(_k: unknown, _id: unknown, _s: unknown, agent: Agent): Promise<void> {
      persisted.push({
        versionHash: agent.status?.versionHash ?? "",
        versionId: agent.metadata?.version?.id ?? "",
        tag: agent.metadata?.version?.tag ?? "",
      });
    },
  } as unknown as Store;
  return { store, persisted, tagCalls: () => tagCalls };
}

function contextWithAgent(): RequestContext<typeof AgentSchema> {
  return new RequestContext(
    AgentSchema,
    create(AgentSchema, {
      metadata: { id: "agt_1", org: "acme", version: { id: HASH, tag: "stable" } },
      status: { versionHash: HASH },
    }),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
}

describe("the agent's SaveVersionAudit — safe degradation", () => {
  it("an archive failure on create clears the hash and version id, re-persists, and assigns no tag", async () => {
    const { store, persisted, tagCalls } = failingStore({ archive: true });
    const ctx = contextWithAgent();

    await newSaveAgentVersionStep(store, silentLogger, true).execute(ctx);

    expect(ctx.newState.status?.versionHash).toBe("");
    expect(ctx.newState.metadata?.version?.id).toBe("");
    expect(tagCalls()).toBe(0);
    expect(persisted).toEqual([{ versionHash: "", versionId: "", tag: "stable" }]);
  });

  it("a tag failure clears the live tag; on update it leaves the write to the chain's Persist", async () => {
    const { store, persisted } = failingStore({ tag: true });
    const ctx = contextWithAgent();

    await newSaveAgentVersionStep(store, silentLogger, false).execute(ctx);

    expect(ctx.newState.metadata?.version?.tag).toBe("");
    expect(ctx.newState.status?.versionHash).toBe(HASH);
    expect(persisted).toEqual([]);
  });
});
