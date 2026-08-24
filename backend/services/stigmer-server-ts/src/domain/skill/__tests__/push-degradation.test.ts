/**
 * Pins ArchiveCurrentSkill's safe-degradation arms (Go push_test.go's
 * failing-store cases) at step level — the composed suite cannot make the
 * real store fail selectively:
 *
 *   - archive (saveAudit) failure clears status.version_hash AND
 *     metadata.version.id — the persisted head never references an
 *     unresolvable audit entry; the push itself still succeeds;
 *   - tag assignment (setAuditTag) failure clears the live spec.tag — the
 *     head never advertises a tag the audit column cannot resolve;
 *   - an UNEXPECTED repoint-lookup failure degrades to archiving anyway (a
 *     possible duplicate row beats a failed push);
 *   - already-archived content repoints: saveAudit is never called, the
 *     tag assignment still runs (re-pushing under a new tag is skills'
 *     only retag path).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { PushSkillRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { AuditNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { SKILL_KEY, newArchiveCurrentSkillStep } from "../push.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const HASH = "b".repeat(64);

interface FakeAuditStore {
  getAuditByHashError: Error | undefined;
  saveAuditError: Error | undefined;
  setAuditTagError: Error | undefined;
  saveAuditCalls: number;
  setAuditTagCalls: Array<{ versionHash: string; tag: string }>;
}

/** A store exposing ONLY the members the step touches; the cast is the seam. */
function fakeStore(overrides?: Partial<FakeAuditStore>): { store: Store; state: FakeAuditStore } {
  const state: FakeAuditStore = {
    getAuditByHashError: new AuditNotFoundError("not archived"),
    saveAuditError: undefined,
    setAuditTagError: undefined,
    saveAuditCalls: 0,
    setAuditTagCalls: [],
    ...overrides,
  };
  const store = {
    async getAuditByHash(): Promise<never> {
      if (state.getAuditByHashError !== undefined) {
        throw state.getAuditByHashError;
      }
      return undefined as never; // "found" — repoint path
    },
    async saveAudit(): Promise<void> {
      state.saveAuditCalls += 1;
      if (state.saveAuditError !== undefined) {
        throw state.saveAuditError;
      }
    },
    async setAuditTag(_k: unknown, _r: unknown, versionHash: string, tag: string): Promise<void> {
      state.setAuditTagCalls.push({ versionHash, tag });
      if (state.setAuditTagError !== undefined) {
        throw state.setAuditTagError;
      }
    },
  } as unknown as Store;
  return { store, state };
}

function contextWithSkill(tag: string) {
  const ctx = new RequestContext(
    PushSkillRequestSchema,
    create(PushSkillRequestSchema, {}),
    ApiResourceKind.skill,
  );
  const skill = create(SkillSchema, {
    metadata: { id: "skl_test", org: "acme", version: { id: HASH } },
    spec: { tag },
    status: { versionHash: HASH },
  });
  ctx.set(SKILL_KEY, skill);
  return { ctx, skill };
}

describe("ArchiveCurrentSkill — safe degradation", () => {
  it("archive failure clears the version hash and version id; the step does not throw", async () => {
    const { store } = fakeStore({ saveAuditError: new Error("disk full") });
    const { ctx, skill } = contextWithSkill("stable");

    await newArchiveCurrentSkillStep(store, silentLogger).execute(ctx);

    expect(skill.status?.versionHash).toBe("");
    expect(skill.metadata?.version?.id).toBe("");
    // The tag assignment never ran — there is no archived row to hold it.
    expect(skill.spec?.tag).toBe("stable");
  });

  it("tag-assignment failure clears the live spec.tag; the archived row stands", async () => {
    const { store, state } = fakeStore({ setAuditTagError: new Error("tag column locked") });
    const { ctx, skill } = contextWithSkill("stable");

    await newArchiveCurrentSkillStep(store, silentLogger).execute(ctx);

    expect(state.saveAuditCalls).toBe(1);
    expect(skill.spec?.tag).toBe("");
    expect(skill.status?.versionHash).toBe(HASH);
  });

  it("an unexpected repoint-lookup failure degrades to archiving anyway", async () => {
    const { store, state } = fakeStore({
      getAuditByHashError: new Error("io error, not AuditNotFound"),
    });
    const { ctx, skill } = contextWithSkill("");

    await newArchiveCurrentSkillStep(store, silentLogger).execute(ctx);

    expect(state.saveAuditCalls).toBe(1);
    expect(skill.status?.versionHash).toBe(HASH);
  });

  it("already-archived content repoints without a new row; the tag still moves", async () => {
    const { store, state } = fakeStore({ getAuditByHashError: undefined });
    const { ctx } = contextWithSkill("stable");

    await newArchiveCurrentSkillStep(store, silentLogger).execute(ctx);

    expect(state.saveAuditCalls).toBe(0);
    expect(state.setAuditTagCalls).toEqual([{ versionHash: HASH, tag: "stable" }]);
  });

  it("a skill with no version hash is a no-op (nothing to archive)", async () => {
    const { store, state } = fakeStore();
    const ctx = new RequestContext(
      PushSkillRequestSchema,
      create(PushSkillRequestSchema, {}),
      ApiResourceKind.skill,
    );
    ctx.set(
      SKILL_KEY,
      create(SkillSchema, { metadata: { id: "skl_x" }, spec: {}, status: {} }),
    );

    await newArchiveCurrentSkillStep(store, silentLogger).execute(ctx);
    expect(state.saveAuditCalls).toBe(0);
    expect(state.setAuditTagCalls).toEqual([]);
  });
});
