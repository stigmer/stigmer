/**
 * Pins SaveVersionAudit's safe-degradation arms at step level — the
 * composed suite (workflow.test.ts) cannot make the real store fail
 * selectively:
 *
 *   - archive (saveAudit) failure clears status.version_hash and
 *     metadata.version.id, so the head never references an unresolvable
 *     audit entry, and the tag is never assigned;
 *   - tag assignment (setAuditTag) failure clears the live
 *     metadata.version.tag, so the head never advertises a tag the audit
 *     column cannot resolve (stigmer/stigmer#855);
 *   - persistOnRevert flushes either revert to the stored row, because on
 *     create no Persist step follows this one; without it (update) the
 *     chain's own Persist flushes the revert and the step writes nothing;
 *   - a failing re-persist is logged, never a failed apply.
 */
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { AuditNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { newSaveVersionAuditStep } from "../steps.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const HASH = "c".repeat(64);

/** What the stored row carried at each re-persist. */
interface PersistedHead {
  versionHash: string;
  versionId: string;
  tag: string;
}

interface FakeAuditStore {
  saveAuditError: Error | undefined;
  setAuditTagError: Error | undefined;
  saveResourceError: Error | undefined;
  setAuditTagCalls: number;
  persisted: PersistedHead[];
}

/** A store exposing ONLY the members the step touches; the cast is the seam. */
function fakeStore(overrides?: Partial<FakeAuditStore>): {
  store: Store;
  state: FakeAuditStore;
} {
  const state: FakeAuditStore = {
    saveAuditError: undefined,
    setAuditTagError: undefined,
    saveResourceError: undefined,
    setAuditTagCalls: 0,
    persisted: [],
    ...overrides,
  };
  const store = {
    async getAuditByHash(): Promise<never> {
      throw new AuditNotFoundError("not archived");
    },
    async saveAudit(): Promise<void> {
      if (state.saveAuditError !== undefined) {
        throw state.saveAuditError;
      }
    },
    async setAuditTag(): Promise<void> {
      state.setAuditTagCalls += 1;
      if (state.setAuditTagError !== undefined) {
        throw state.setAuditTagError;
      }
    },
    async saveResource(
      _k: unknown,
      _id: unknown,
      _schema: unknown,
      wf: Workflow,
    ): Promise<void> {
      state.persisted.push({
        versionHash: wf.status?.versionHash ?? "",
        versionId: wf.metadata?.version?.id ?? "",
        tag: wf.metadata?.version?.tag ?? "",
      });
      if (state.saveResourceError !== undefined) {
        throw state.saveResourceError;
      }
    },
  } as unknown as Store;
  return { store, state };
}

function contextWithWorkflow(
  tag: string,
): RequestContext<typeof WorkflowSchema> {
  return new RequestContext(
    WorkflowSchema,
    create(WorkflowSchema, {
      metadata: {
        id: "wfl_test",
        org: "acme",
        version: { id: HASH, tag },
      },
      status: { versionHash: HASH },
    }),
    testCallerIdentity(),
    ApiResourceKind.workflow,
  );
}

/** The create chain's arguments: isCreate, and no Persist follows. */
function createStep(store: Store) {
  return newSaveVersionAuditStep(store, silentLogger, true, true);
}

describe("SaveVersionAudit — safe degradation", () => {
  it("tag failure on create clears the live tag and re-persists the row tagless", async () => {
    const { store, state } = fakeStore({
      setAuditTagError: new Error("tag column locked"),
    });
    const ctx = contextWithWorkflow("stable");

    await createStep(store).execute(ctx);

    expect(ctx.newState.metadata?.version?.tag).toBe("");
    expect(state.persisted).toEqual([
      { versionHash: HASH, versionId: HASH, tag: "" },
    ]);
  });

  it("tag failure without persistOnRevert clears the live tag and leaves the write to the chain's Persist", async () => {
    const { store, state } = fakeStore({
      setAuditTagError: new Error("tag column locked"),
    });
    const ctx = contextWithWorkflow("stable");

    await newSaveVersionAuditStep(store, silentLogger, true, false).execute(
      ctx,
    );

    expect(ctx.newState.metadata?.version?.tag).toBe("");
    expect(state.persisted).toEqual([]);
  });

  it("archive failure on create clears the hash and version id, re-persists, and never assigns the tag", async () => {
    const { store, state } = fakeStore({
      saveAuditError: new Error("disk full"),
    });
    const ctx = contextWithWorkflow("stable");

    await createStep(store).execute(ctx);

    expect(ctx.newState.status?.versionHash).toBe("");
    expect(ctx.newState.metadata?.version?.id).toBe("");
    expect(state.setAuditTagCalls).toBe(0);
    expect(state.persisted).toEqual([
      { versionHash: "", versionId: "", tag: "stable" },
    ]);
  });

  it("a failing re-persist after a tag failure is logged, and the step does not throw", async () => {
    const { store, state } = fakeStore({
      setAuditTagError: new Error("tag column locked"),
      saveResourceError: new Error("connection reset"),
    });
    const ctx = contextWithWorkflow("stable");

    await expect(createStep(store).execute(ctx)).resolves.toBeUndefined();

    expect(ctx.newState.metadata?.version?.tag).toBe("");
    expect(state.persisted).toHaveLength(1);
  });

  it("a clean archive and tag write nothing beyond the audit row", async () => {
    const { store, state } = fakeStore();
    const ctx = contextWithWorkflow("stable");

    await createStep(store).execute(ctx);

    expect(ctx.newState.metadata?.version?.tag).toBe("stable");
    expect(state.setAuditTagCalls).toBe(1);
    expect(state.persisted).toEqual([]);
  });
});
