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
 * subject-only and must not surface in org-visible search). The list
 * index the reads use (list-index.ts) is not search: the store keeps it
 * beside the row, and it holds the org, the subject id and the creation
 * instant, never content.
 *
 * Proven by memory.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/memory.test.ts.
 */
import { create, equals, isMessage } from "@bufbuild/protobuf";
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
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { isServerComposedRequest } from "../../extensions/identity.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import {
  generateId,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { memoryCaptureCredentialOf } from "../../pipeline/steps/guard-memory-capture.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";
import {
  accountForCaller,
  accountForStamp,
} from "../identityaccount/resolve.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { listOrganizationMemories, listSubjectMemories } from "./queries.js";
import {
  MAX_MEMORIES_PER_SUBJECT,
  MEMORY_ACCOUNT_DISABLED_MESSAGE,
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
 *  3. Overwrites spec.subject_identity_account_id, server-derived and
 *     never client-supplied (DD-005 D2), by posture. Under the
 *     single-operator posture (no `personAccounts` composed) it is the
 *     empty-string sentinel — the laptop's one subject (the OAuth grant
 *     store convention). Where callers are persons it is the id of the
 *     identity account the memory is ABOUT (stigmer#1387, the Java
 *     MemoryCreateHandler's subject): the admitted capture credential's
 *     subject (point 5), else the calling person — each resolved through
 *     the identity-account domain (accountForStamp / accountForCaller),
 *     so a subject that arrived as a raw issuer subject is filed under
 *     the account every FGA tuple names. The resolved account rides the
 *     context under MEMORY_SUBJECT_ACCOUNT_KEY for CheckMemoryEnablement,
 *     so the subject stamped and the consent checked are one row, read
 *     once. A caller no account stands for is stamped "" and NOT refused
 *     here: the refusal belongs behind AuthorizeResolvedTarget, which
 *     runs between the two steps so a refused caller learns nothing.
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
 *  5. When GuardMemoryCapture admitted a session-scoped capture
 *     credential (the composed provider's authorizeMemoryCapture
 *     capability — parity entry 20260830.05), the token's PROVED claims
 *     replace both edition defaults: the subject is the credential's
 *     human ("the sub IS the human subject the session belongs to",
 *     Java MemoryCreateHandler) and provenance.session_id is overridden
 *     with the token's own session claim (server-proved beats
 *     runner-reported). Absent the handoff, the arms above apply
 *     unchanged.
 */
export function newResolveMemoryDefaultsStep(
  personAccounts?: AccountsByCaller,
): PipelineStep<typeof MemorySchema> {
  return {
    name: "ResolveMemoryDefaults",
    async execute(ctx: RequestContext<typeof MemorySchema>): Promise<void> {
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

      // The subject stays server-owned (DD-005 D2), by posture (step doc
      // points 3 and 5).
      const captureCredential = memoryCaptureCredentialOf(ctx);
      if (personAccounts === undefined) {
        spec.subjectIdentityAccountId =
          captureCredential?.subjectIdentityAccountId ?? "";
      } else {
        const account = await resolveSubjectAccount(
          personAccounts,
          ctx,
          captureCredential?.subjectIdentityAccountId,
        );
        spec.subjectIdentityAccountId = account?.metadata?.id ?? "";
        if (account !== undefined) {
          ctx.set(MEMORY_SUBJECT_ACCOUNT_KEY, account);
        }
      }

      // Provenance is capture-path-supplied (see the step doc, point 4);
      // only tool_call_id is force-cleared — unreachable via MCP in v1, so
      // a supplied value could only be an invention.
      if (spec.provenance !== undefined) {
        spec.provenance.toolCallId = "";
      }
      // An admitted capture credential's session claim overrides the
      // threaded value (step doc point 5) — server-proved attribution.
      if (captureCredential !== undefined) {
        if (spec.provenance === undefined) {
          spec.provenance = create(MemoryProvenanceSchema, {});
        }
        spec.provenance.sessionId = captureCredential.provedSessionId;
      }
    },
  };
}

/**
 * Context key carrying the identity account a memory is about, from
 * ResolveMemoryDefaults to CheckMemoryEnablement — present exactly when
 * callers are persons and the subject resolved (step doc point 3).
 */
export const MEMORY_SUBJECT_ACCOUNT_KEY = "memorySubjectAccount";

/** The subject's account stashed by ResolveMemoryDefaults, if any. */
export function memorySubjectAccountOf(
  ctx: RequestContext<typeof MemorySchema>,
): IdentityAccount | undefined {
  const payload = ctx.get(MEMORY_SUBJECT_ACCOUNT_KEY);
  return isMessage(payload, IdentityAccountSchema) ? payload : undefined;
}

/**
 * The account the memory is about: the capture credential's subject read
 * as a creator-style stamp (an account id, or a raw issuer subject), else
 * the account the calling person stands for. `undefined` when nobody
 * resolves. A store fault is an infrastructure fault; an account row with
 * no id is a loud one, never an empty principal (the resolve.ts rule).
 */
async function resolveSubjectAccount(
  personAccounts: AccountsByCaller,
  ctx: RequestContext<typeof MemorySchema>,
  credentialSubject: string | undefined,
): Promise<IdentityAccount | undefined> {
  let account: IdentityAccount | undefined;
  try {
    account =
      credentialSubject !== undefined
        ? await accountForStamp(personAccounts, credentialSubject)
        : await accountForCaller(personAccounts, ctx.callerIdentity);
  } catch (error) {
    throw internalError(
      error,
      "failed to resolve the identity account a memory is about",
    );
  }
  if (account !== undefined && (account.metadata?.id ?? "") === "") {
    throw internalError(
      new Error("identity account carries no id"),
      "failed to resolve the identity account a memory is about",
    );
  }
  return account;
}

/** The deny copy of the create lane's organization bar. */
export const MEMORY_CREATE_DENIED_MESSAGE =
  "unauthorized to capture memory in this organization";

/**
 * The create lane's authorization question, for AuthorizeResolvedTarget
 * after ResolveMemoryDefaults (which requires metadata.org) and BEFORE
 * CheckMemoryEnablement, so a refused caller learns nothing about the
 * organization's memory settings. The RPC is is_skip_authorization
 * because the row does not exist yet and the subject IS the caller
 * (command.proto); GuardMemoryCapture is the gate that decides WHO may
 * capture at all, and this question is WHERE: can_create_session on
 * metadata.org — memory is captured inside a conversation, so whoever may
 * converse in an organization may remember there.
 *
 * The credentialed capture lane is already scoped to the run's
 * organization by the credential provider (a mismatch is refused inside
 * GuardMemoryCapture with its own copy); this question closes the plain
 * path, a person with no run credential naming an organization they hold
 * nothing in. A server-composed traversal asks nothing, as the gate itself
 * says: the entry-point request already passed.
 */
export function resolveMemoryCreateTargets(
  ctx: RequestContext<typeof MemorySchema>,
): ReadonlyArray<AuthorizationTarget> {
  if (isServerComposedRequest(ctx.callerIdentity)) {
    return [];
  }
  return [
    {
      permission: IamPermission.can_create_session,
      resourceKind: ApiResourceKind.organization,
      resourceId: ctx.newState.metadata?.org ?? "",
      deniedMessage: MEMORY_CREATE_DENIED_MESSAGE,
    },
  ];
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
 * The double opt-in (DD-006 D1), in the Java handler's order: the
 * organization's switch first (the gate an admin controls), then — where
 * callers are persons (`personAccounts` composed) — the switch of the
 * person the memory is about, read from the account ResolveMemoryDefaults
 * resolved and stashed (stigmer#1387). No stashed account under that
 * posture refuses with the person's copy: nobody the server can name has
 * consented. The single-operator posture checks the org flag alone — its
 * one operator is the organization's decider. Who may capture at all is
 * GuardMemoryCapture's question, not this step's.
 *
 * Reads the Organization row directly from the store, matching Go — no
 * cross-domain client.
 */
export function newCheckMemoryEnablementStep(
  store: Store,
  personAccounts?: AccountsByCaller,
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

      if (personAccounts === undefined) {
        return;
      }
      const subject = memorySubjectAccountOf(ctx);
      if (subject?.spec?.preferences?.memoryEnabled !== true) {
        throw failedPreconditionError(MEMORY_ACCOUNT_DISABLED_MESSAGE);
      }
    },
  };
}

/**
 * CheckMemoryCap — Go checkMemoryCapStep: enforces the
 * per-subject-per-org record ceiling at create (DD-006 D5). Counted
 * across all lifecycle states, from the subject's own rows in the org
 * through the memory list index (queries.ts), so a capture never reads
 * another person's or another organization's memories.
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

      let count: number;
      try {
        count = (await listSubjectMemories(store, org, subject)).length;
      } catch (error) {
        throw internalError(error, "failed to count memories for cap check");
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
 * ListMemoriesByOrg — Go listMemoriesByOrgStep (list.go): reads the
 * org's memories through the memory list index (queries.ts), created_at
 * descending (newest first) — the index order, which the read scope
 * keeps. Ordering is chronological only; grouping pending proposals first
 * is the console's presentation concern (DD-005 D4), deliberately not an
 * RPC parameter at the kind's dozens-of-records scale.
 */
export function newListMemoriesByOrgStep(
  store: Store,
  listReadScope: ListReadScope | undefined,
): PipelineStep<typeof ListMemoriesRequestSchema> {
  return {
    name: "ListMemoriesByOrg",
    async execute(
      ctx: RequestContext<typeof ListMemoriesRequestSchema>,
    ): Promise<void> {
      const org = ctx.input.org;

      let orgMemories: Memory[];
      try {
        orgMemories = await listOrganizationMemories(store, org);
      } catch (error) {
        throw internalError(error, "failed to list memories");
      }

      // 20260830.01 census lane 11: the org equality serves the Java
      // handler's org arm in both editions and runs FIRST; the scope
      // narrows the org's rows last (the scope is the last per-row
      // predicate, stigmer-cloud 20260913.04 T02).
      const memories = await restrictListByReadScope(
        listReadScope,
        ctx.callerIdentity,
        ApiResourceKind.memory,
        orgMemories,
        "",
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
