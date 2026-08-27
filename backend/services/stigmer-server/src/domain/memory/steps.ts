/**
 * Memory domain steps — port pkg/domain/memory/controller/steps.go,
 * update.go's graft persist, transition.go's atomic decided-state write,
 * and list.go's org filter.
 *
 * The consent doctrine these steps embody (DD-004/DD-005/DD-006): a
 * memory is agent-proposed and user-confirmed; the server claims every
 * field it owns at create (subject sentinel, provenance tool_call_id);
 * updates graft only what the request path owns onto the LIVE row so a
 * spec edit can never rewrite a consent decision; confirm/reject are the
 * ONLY writers of status.lifecycle_state.
 *
 * Deliberately NO search-extractor and NO index steps anywhere in this
 * domain: memory is not_search_indexed by design (privacy — content is
 * subject-only and must not surface in org-visible search).
 *
 * Proven by memory.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/memory.test.ts.
 */
import { create, equals, fromBinary } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import type { ConnectError } from "@connectrpc/connect";

import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import type { MemoryIdSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/io_pb";
import type { ListMemoriesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/io_pb";
import { MemoryListSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/io_pb";
import { MemoryProvenanceSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/spec_pb";
import { MemoryStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import {
  generateId,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  MAX_MEMORIES_PER_SUBJECT,
  MEMORY_FULL_MESSAGE,
  MEMORY_PROVENANCE_IMMUTABLE_MESSAGE,
  MEMORY_SUBJECT_IMMUTABLE_MESSAGE,
  memoryDisabledMessage,
} from "./constants.js";

/** Context key for the list result — Go listResultKey. */
export const LIST_RESULT_KEY = "listResult";

/**
 * ResolveMemoryDefaults — Go resolveMemoryDefaultsStep: prepares a memory
 * for creation — the server claiming every field it owns, before anything
 * persists:
 *
 *  1. Requires metadata.org — memory records are org-scoped (DD-004), so
 *     the org can never be inferred.
 *  2. Mints metadata.id here (not in BuildNewState) when absent, so an
 *     unnamed record can default its name/slug from its own identity:
 *     memories are id-addressed records (the remember tool sends content
 *     only), and the platform's slug machinery requires a name. A
 *     client-supplied name still wins — the default only fills absence.
 *  3. Overwrites spec.subject_identity_account_id with the empty-string
 *     sentinel — the OSS single-user subject (the OAuth grant store
 *     convention). Server-derived, never client-supplied (DD-005 D2):
 *     the cloud edition writes the caller's identity account here.
 *  4. Stores spec.provenance as supplied (Stage 3 provenance decision,
 *     owner-ratified 2026-08-22): the capture path — the remember tool
 *     via the runner-synthesized attachment — threads the agent/session/
 *     execution triple, and in OSS single-user local mode every caller
 *     IS the trusted local operator, so supplied attribution is stored
 *     rather than cleared. A direct create simply supplies none and the
 *     field stays empty. tool_call_id is force-cleared: MCP cannot carry
 *     the harness's tool-call identity in v1, so a supplied value could
 *     only be an invention. The cloud edition is stricter — it accepts
 *     the triple only from a session-sandbox credential and overrides
 *     session/org with the token's own claims. Post-create the field is
 *     immutable either way (ValidateMemoryUpdate): attribution that can
 *     be edited is not attribution.
 */
export function newResolveMemoryDefaultsStep(): PipelineStep<
  typeof MemorySchema
> {
  return {
    name: "ResolveMemoryDefaults",
    execute(ctx: RequestContext<typeof MemorySchema>): void {
      const memory = ctx.newState;
      const metadata = memory.metadata;

      if ((metadata?.org ?? "") === "") {
        throw invalidArgumentError("metadata.org is required for a memory");
      }
      // Narrowing only: a defined org implies defined metadata.
      if (metadata === undefined) {
        throw internalError(new Error("metadata is nil"), "metadata is nil");
      }

      if (metadata.id === "") {
        metadata.id = generateId("mem");
      }
      if (metadata.name === "" && metadata.slug === "") {
        metadata.name = metadata.id;
      }

      // Go dereferences spec unconditionally (a nil spec panics into
      // Internal); the explicit throw keeps the same wire code.
      const spec = memory.spec;
      if (spec === undefined) {
        throw internalError(
          new Error("memory spec is nil"),
          "memory spec is nil",
        );
      }

      // The subject stays server-owned (DD-005 D2): the OSS sentinel; the
      // cloud edition derives it from the calling credential.
      spec.subjectIdentityAccountId = "";

      // Provenance is capture-path-supplied (see the step doc, point 4);
      // only tool_call_id is force-cleared — unreachable via MCP in v1, so
      // a supplied value could only be an invention.
      if (spec.provenance !== undefined) {
        spec.provenance.toolCallId = "";
      }
    },
  };
}

/**
 * CheckMemoryEnablement — Go checkMemoryEnablementStep: enforces the
 * org's memory_enabled switch at write time, FAIL-CLOSED (DD-005 D2): a
 * write that cannot verify enablement refuses. This deliberately inverts
 * the recall compose step's best-effort posture — an execution must start
 * without its optional preferences, but a memory must never be stored
 * without verified consent to store it.
 *
 * The runner-side remember-tool attachment is convenience, never
 * authorization: "the label is not authorization; the server refuses"
 * (the conversation-attachment doctrine, applied verbatim).
 *
 * OSS checks the org flag alone — the user scope collapses in single-user
 * local mode (DD-006 D1). The cloud edition additionally requires the
 * caller's own memory_enabled and the strict first-party-human gate.
 *
 * Reads the Organization row directly from the store, matching Go — no
 * cross-domain client.
 */
export function newCheckMemoryEnablementStep(
  store: Store,
): PipelineStep<typeof MemorySchema> {
  return {
    name: "CheckMemoryEnablement",
    async execute(ctx: RequestContext<typeof MemorySchema>): Promise<void> {
      const orgID = ctx.newState.metadata?.org ?? "";

      let org;
      try {
        org = await store.getResource(
          ApiResourceKind.organization,
          orgID,
          OrganizationSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Organization", orgID);
        }
        throw internalError(
          error,
          "failed to load organization for memory enablement check",
        );
      }

      if (org.spec?.preferences?.memoryEnabled !== true) {
        throw failedPreconditionError(memoryDisabledMessage(orgID));
      }
    },
  };
}

/**
 * CheckMemoryCap — Go checkMemoryCapStep: enforces the
 * per-subject-per-org record ceiling at create (DD-006 D5). Counted
 * across all lifecycle states. A full-scan count matches the store's
 * local/OSS posture at the kind's dozens-of-records scale (the schedule
 * list precedent); the cloud edition counts through an indexed
 * repository query.
 */
export function newCheckMemoryCapStep(
  store: Store,
): PipelineStep<typeof MemorySchema> {
  return {
    name: "CheckMemoryCap",
    async execute(ctx: RequestContext<typeof MemorySchema>): Promise<void> {
      const newState = ctx.newState;
      const org = newState.metadata?.org ?? "";
      const subject = newState.spec?.subjectIdentityAccountId ?? "";

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.memory);
      } catch (error) {
        throw internalError(error, "failed to count memories for cap check");
      }

      let count = 0;
      for (const bytes of rows) {
        const existing = unmarshalMemory(bytes);
        if (existing === undefined) {
          continue;
        }
        if ((existing.metadata?.org ?? "") !== org) {
          continue;
        }
        if ((existing.spec?.subjectIdentityAccountId ?? "") !== subject) {
          continue;
        }
        count++;
      }

      if (count >= MAX_MEMORIES_PER_SUBJECT) {
        throw failedPreconditionError(MEMORY_FULL_MESSAGE);
      }
    },
  };
}

/**
 * InitializeMemoryLifecycle — Go initializeMemoryLifecycleStep: stamps
 * the initial consent state after BuildNewState wiped client-provided
 * status: every memory starts proposed (DD-005 D2) — nothing is
 * recallable until the subject confirms. Runs after BuildNewState so the
 * wipe cannot undo it and the audit block it set is preserved.
 */
export function newInitializeMemoryLifecycleStep(): PipelineStep<
  typeof MemorySchema
> {
  return {
    name: "InitializeMemoryLifecycle",
    execute(ctx: RequestContext<typeof MemorySchema>): void {
      const memory = ctx.newState;
      if (memory.status === undefined) {
        memory.status = create(MemoryStatusSchema, {});
      }
      memory.status.lifecycleState =
        MemoryLifecycleState.lifecycle_state_proposed;
      memory.status.stateChangedAt = timestampNow();
    },
  };
}

/**
 * ValidateMemoryUpdate — Go validateMemoryUpdateStep: enforces the
 * memory's immutable identity on update (the Schedule agent_ref pattern):
 *
 *   - spec.subject_identity_account_id must not change: an editable
 *     subject would re-aim the record at another person, silently
 *     defeating the subject-only visibility model.
 *   - spec.provenance must not change, byte for byte: provenance is
 *     attribution, displayed beside the fact everywhere — attribution
 *     that can be edited is not attribution (DD-004).
 *
 * Update replaces the spec wholesale (declarative semantics), so callers
 * carry the loaded values — the generated toMemoryUpdateInput mapper does
 * this by construction. metadata.slug/org immutability needs no step
 * here: the generic BuildUpdateState preserves both. The lifecycle state
 * is protected by MECHANISM, not validation: PersistMemoryUpdate grafts
 * only metadata+spec+status.audit onto the live row.
 *
 * Runs after LoadExisting so the existing state is available.
 */
export function newValidateMemoryUpdateStep(): PipelineStep<
  typeof MemorySchema
> {
  return {
    name: "ValidateMemoryUpdate",
    execute(ctx: RequestContext<typeof MemorySchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Memory | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing memory not found in context"),
          "existing memory not found in context",
        );
      }
      const newState = ctx.newState;

      if (
        (newState.spec?.subjectIdentityAccountId ?? "") !==
        (existing.spec?.subjectIdentityAccountId ?? "")
      ) {
        throw failedPreconditionError(MEMORY_SUBJECT_IMMUTABLE_MESSAGE);
      }

      // Go proto.Equal on nils: both nil → equal; one nil (even against an
      // empty message) → not equal. protobuf-es equals requires two
      // messages, so the undefined arms branch explicitly.
      const newProvenance = newState.spec?.provenance;
      const existingProvenance = existing.spec?.provenance;
      const provenanceEqual =
        newProvenance === undefined || existingProvenance === undefined
          ? newProvenance === existingProvenance
          : equals(MemoryProvenanceSchema, newProvenance, existingProvenance);
      if (!provenanceEqual) {
        throw failedPreconditionError(MEMORY_PROVENANCE_IMMUTABLE_MESSAGE);
      }
    },
  };
}

/**
 * PersistMemoryUpdate — Go persistMemoryUpdateStep (update.go): persists
 * an update as a graft of exactly what the request path owns —
 * apiVersion/kind/metadata/spec plus the audit bump BuildUpdateState
 * stamped — onto the LIVE row, inside one store.updateResource closure.
 * NOT the generic Persist: memory status has other writers
 * (confirm/reject), and a full-row save of the load-time snapshot could
 * silently revert a consent decision made between this pipeline's load
 * and its persist. The schedule domain's persistScheduleUpdateStep is the
 * direct template (DD-015 D-C shape).
 *
 * The graft never resurrects a concurrently deleted row: updateResource
 * answers not-found, relayed as NOT_FOUND — the delete won, honestly.
 */
export function newPersistMemoryUpdateStep(
  store: Store,
): PipelineStep<typeof MemorySchema> {
  return {
    name: "PersistMemoryUpdate",
    async execute(ctx: RequestContext<typeof MemorySchema>): Promise<void> {
      const newState = ctx.newState;
      const memoryId = newState.metadata?.id ?? "";

      let live: Memory;
      try {
        live = await store.updateResource(
          ApiResourceKind.memory,
          memoryId,
          MemorySchema,
          (row) => {
            row.apiVersion = newState.apiVersion;
            row.kind = newState.kind;
            row.metadata = newState.metadata;
            row.spec = newState.spec;
            // The one status subtree the request path owns: its own audit
            // bump. The lifecycle leaves stay exactly as their owners
            // (create/confirm/reject) last wrote them.
            if (newState.status?.audit !== undefined) {
              if (row.status === undefined) {
                row.status = create(MemoryStatusSchema, {});
              }
              row.status.audit = newState.status.audit;
            }
          },
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Memory", memoryId);
        }
        throw internalError(error, "failed to persist memory update");
      }

      // Answer with the persisted post-image: the new spec plus the LIVE
      // status — honest about any consent decision that landed mid-request.
      ctx.setNewState(live);
    },
  };
}

/**
 * TransitionMemoryLifecycle — Go transitionMemoryLifecycleStep: moves a
 * memory's consent lifecycle to a target decided state in ONE
 * store.updateResource closure on the freshly-read row — confirm and
 * reject share this step because they are one contract with opposite
 * verdicts (DD-005 D3).
 *
 * Transition matrix (see MemoryLifecycleState's doc):
 *   - proposed (or unspecified, defensively) → target: written, with
 *     state_changed_at and a StatusAudit bump.
 *   - already the target → idempotent success, no write, no audit bump
 *     (Go aborts the write by returning a sentinel error from the
 *     closure; here the sentinel throw rolls the transaction back — the
 *     same no-write property).
 *   - the OPPOSITE decided state → FAILED_PRECONDITION with the
 *     cross-edition copy: decisions do not flip — deletion is the way out
 *     of confirmed (revocation) and out of rejected (making room for a
 *     fresh proposal).
 *
 * The atomic closure is adopted from schedule's clearSchedulePauseStep:
 * memory has no concurrent status writer yet in Stage 1, but Stage 2's
 * recall reads and any future writer get the discipline for free, and a
 * concurrent delete is already answered honestly (NOT_FOUND — the delete
 * won).
 *
 * Answers with the post-image row: EXISTING_RESOURCE_KEY is set to the
 * live row on both the transitioned and idempotent paths.
 */
export function newTransitionMemoryLifecycleStep(
  store: Store,
  target: MemoryLifecycleState,
  blockedMessage: string,
): PipelineStep<typeof MemoryIdSchema> {
  return {
    name: "TransitionMemoryLifecycle",
    async execute(ctx: RequestContext<typeof MemoryIdSchema>): Promise<void> {
      const loaded = ctx.get(EXISTING_RESOURCE_KEY) as Memory;
      const memoryId = loaded.metadata?.id ?? "";

      // Aborts the atomic write on the idempotent path — the record is
      // already in the target state, so nothing is written and no audit
      // bumps (Go errTransitionNoOp).
      const transitionNoOp = new Error("memory already in target state");
      let blocked: ConnectError | undefined;
      let live: Memory | undefined;
      try {
        live = await store.updateResource(
          ApiResourceKind.memory,
          memoryId,
          MemorySchema,
          (row) => {
            // Capture the freshly-read row so the idempotent abort still
            // answers with the untouched post-image.
            live = row;
            const current =
              row.status?.lifecycleState ??
              MemoryLifecycleState.lifecycle_state_unspecified;
            if (current === target) {
              throw transitionNoOp;
            }
            if (
              current !== MemoryLifecycleState.lifecycle_state_proposed &&
              current !== MemoryLifecycleState.lifecycle_state_unspecified
            ) {
              // The opposite decided state: refuse without writing.
              blocked = failedPreconditionError(blockedMessage);
              throw blocked;
            }
            if (row.status === undefined) {
              row.status = create(MemoryStatusSchema, {});
            }
            row.status.lifecycleState = target;
            row.status.stateChangedAt = timestampNow();
            setAuditFieldsForUpdate(
              MemorySchema,
              row,
              "status_audit",
              ctx.callerIdentity,
            );
          },
        );
      } catch (error) {
        if (error !== transitionNoOp) {
          if (blocked !== undefined && error === blocked) {
            throw blocked;
          }
          if (error instanceof ResourceNotFoundError) {
            // Deleted between load and transition: the delete won.
            throw notFoundError("Memory", memoryId);
          }
          throw internalError(error, "failed to transition memory lifecycle");
        }
      }
      if (live === undefined) {
        // Unreachable: every surviving path assigned the freshly-read row.
        throw internalError(
          new Error("transition closure did not observe the row"),
          "failed to transition memory lifecycle",
        );
      }

      // live holds the post-image (transitioned, or the untouched row on
      // the idempotent path) — the honest response either way.
      ctx.set(EXISTING_RESOURCE_KEY, live);
    },
  };
}

/**
 * ListMemoriesByOrg — Go listMemoriesByOrgStep (list.go): loads all
 * memories and filters by org, sorted by created_at descending (newest
 * first) — the schedule list posture. Ordering is chronological only;
 * grouping pending proposals first is the console's presentation concern
 * (DD-005 D4), deliberately not an RPC parameter at the kind's
 * dozens-of-records scale.
 */
export function newListMemoriesByOrgStep(
  store: Store,
): PipelineStep<typeof ListMemoriesRequestSchema> {
  return {
    name: "ListMemoriesByOrg",
    async execute(
      ctx: RequestContext<typeof ListMemoriesRequestSchema>,
    ): Promise<void> {
      const org = ctx.input.org;

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.memory);
      } catch (error) {
        throw internalError(error, "failed to list memories");
      }

      const memories: Memory[] = [];
      for (const bytes of rows) {
        const memory = unmarshalMemory(bytes);
        if (memory === undefined) {
          continue;
        }
        if ((memory.metadata?.org ?? "") !== org) {
          continue;
        }
        memories.push(memory);
      }

      memories.sort((a, b) =>
        compareCreatedAtDesc(
          a.status?.audit?.specAudit?.createdAt,
          b.status?.audit?.specAudit?.createdAt,
        ),
      );

      ctx.set(
        LIST_RESULT_KEY,
        create(MemoryListSchema, {
          totalCount: memories.length,
          items: memories,
        }),
      );
    },
  };
}

/**
 * Decodes a stored memory, skipping invalid entries (should not happen in
 * normal operation) — Go unmarshalMemory.
 */
function unmarshalMemory(data: Uint8Array): Memory | undefined {
  try {
    return fromBinary(MemorySchema, data);
  } catch {
    return undefined;
  }
}
