/**
 * The open-source IamPolicyStore: the port (store.ts) over the generic
 * Store, rows of the `resources` table by kind (20260913.01, T01_0_plan.md
 * §3a, §4). The composition root installs it when no extension registers
 * `drivers.iamPolicyStore`.
 *
 * Reads. `findById` is a PRIMARY-KEY read. Every other find decodes
 * `listResources(iam_policy)` and filters in memory: the `resources` table
 * has no secondary index and `findByField` is single-hit, so a scan is the
 * honest shape, and the row count is members × organizations on a
 * self-host — measured in the entry's execution record (§4), not assumed.
 * The filters are the cloud store's WHERE clauses restated over the proto
 * (store.ts names each), so a driver's test over either edition reads the
 * same contract.
 *
 * Writes. `save` refuses a policy whose id is not its triple's derived id
 * (constants.ts policyIdFor): open source has no legacy random ids, and a
 * stray id would break the primary key's promise of one row per triple.
 * It is then read-then-write refusing a held id with DuplicatePolicyError,
 * because the generic Store's saveResource is an upsert with no
 * create-only form — the 2a adapter's shape and its recorded residual
 * window (two concurrent saves of one triple may both fulfil; the primary
 * key still guarantees ONE row, which is the invariant that matters, and
 * the grant path treats a same-triple winner as the duplicate arm either
 * way). Conditional store writes are a platform-wide follow-up, not this
 * adapter's to invent.
 *
 * Store faults follow the ratified mapping (domain/apikey/lookup.ts): a
 * typed ResourceNotFoundError reads as `undefined`; anything else
 * propagates — an outage must never read as "no grant".
 *
 * The port's contract is proven by store-contract.ts, run over this
 * adapter on both drivers in __tests__/resource-store.test.ts, which also
 * pins the derived-id refusal that is this adapter's own.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { USER_GRANT_PRINCIPAL_KINDS, policyIdFor } from "./constants.js";
import { DuplicatePolicyError } from "./store.js";
import type { IamPolicyStore } from "./store.js";

const KIND = ApiResourceKind.iam_policy;

/**
 * The cloud SQL's scope-tuple exclusions (store.ts): a scope tuple is a
 * row whose principal is a RESOURCE and whose relation is structural. The
 * principal half is derived from the user lane's grantee vocabulary
 * (constants.ts USER_GRANT_PRINCIPAL_KINDS; Q-S9-2) so the writer's "who a
 * person may grant to" and the reader's "what is a person, not a parent"
 * are one definition: the identity account and the team.
 */
const NON_STRUCTURAL_PRINCIPAL_KINDS: ReadonlyArray<string> =
  USER_GRANT_PRINCIPAL_KINDS.map((kind) => kindEnumName(kind));
const NON_STRUCTURAL_RELATIONS: ReadonlyArray<string> = ["owner", "creator"];

export function newResourceIamPolicyStore(store: Store): IamPolicyStore {
  async function readById(id: string): Promise<IamPolicy | undefined> {
    try {
      return await store.getResource(KIND, id, IamPolicySchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  /** Every row of the kind, decoded — the scan behind every non-id read. */
  async function all(): Promise<ReadonlyArray<IamPolicy>> {
    const rows = await store.listResources(KIND);
    return rows.map((bytes) => fromBinary(IamPolicySchema, bytes));
  }

  async function where(
    predicate: (policy: IamPolicy) => boolean,
  ): Promise<ReadonlyArray<IamPolicy>> {
    return (await all()).filter(predicate);
  }

  return {
    async save(policy): Promise<void> {
      const id = policy.metadata?.id ?? "";
      if (policy.spec === undefined || id !== policyIdFor(policy.spec)) {
        throw new Error("policy id must be derived from its triple");
      }
      if ((await readById(id)) !== undefined) {
        throw new DuplicatePolicyError(`IAM policy '${id}' already exists`);
      }
      await store.saveResource(KIND, id, IamPolicySchema, policy);
    },

    async deleteById(id): Promise<void> {
      await store.deleteResource(KIND, id);
    },

    findById: readById,

    findByPrincipal(principalKind, principalId) {
      return where((policy) => onPrincipal(policy, principalKind, principalId));
    },

    findByResource(resourceKind, resourceId) {
      return where((policy) => onResource(policy, resourceKind, resourceId));
    },

    findByPrincipalAndResource(
      principalKind,
      principalId,
      resourceKind,
      resourceId,
    ) {
      return where(
        (policy) =>
          onPrincipal(policy, principalKind, principalId) &&
          onResource(policy, resourceKind, resourceId),
      );
    },

    findByResourceWithRelations(resourceKind, resourceId, relations) {
      return where(
        (policy) =>
          onResource(policy, resourceKind, resourceId) &&
          relations.includes(relationOf(policy)),
      );
    },

    async countDistinctPrincipalsByResource(
      resourceKind,
      resourceId,
      principalKind,
      relations,
    ): Promise<number> {
      const principals = new Set<string>();
      for (const policy of await all()) {
        if (
          onResource(policy, resourceKind, resourceId) &&
          relations.includes(relationOf(policy)) &&
          (principalKind === undefined ||
            policy.spec?.principal?.kind === principalKind)
        ) {
          principals.add(
            `${policy.spec?.principal?.kind ?? ""}:${policy.spec?.principal?.id ?? ""}`,
          );
        }
      }
      return principals.size;
    },

    async findScopeTuple(resourceKind, resourceId) {
      return (await all()).find(
        (policy) =>
          onResource(policy, resourceKind, resourceId) &&
          !NON_STRUCTURAL_PRINCIPAL_KINDS.includes(
            policy.spec?.principal?.kind ?? "",
          ) &&
          !NON_STRUCTURAL_RELATIONS.includes(relationOf(policy)),
      );
    },
  };
}

function onPrincipal(policy: IamPolicy, kind: string, id: string): boolean {
  return (
    policy.spec?.principal?.kind === kind && policy.spec?.principal?.id === id
  );
}

function onResource(policy: IamPolicy, kind: string, id: string): boolean {
  return (
    policy.spec?.resource?.kind === kind && policy.spec?.resource?.id === id
  );
}

function relationOf(policy: IamPolicy): string {
  return policy.spec?.relation ?? "";
}
