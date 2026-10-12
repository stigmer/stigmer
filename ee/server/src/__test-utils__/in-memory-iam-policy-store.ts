/**
 * An IamPolicy store held in memory: the library's IamPolicyStore port
 * (`@stigmer/server`) plus the one read the Enterprise identity unit's
 * owner-row reconcile adds, `findByResourceKindAndRelation` (the unit's
 * `OwnerRowReads`, which this file matches by shape rather than import,
 * so it stays neutral). A host
 * that composes the unit on open source's own authorization registers one
 * store as the library's `drivers.iamPolicyStore` and hands the same one
 * to the unit, so the grant path's writes are the rows the unit reads;
 * this is that store for the suites that compose it so.
 *
 * It is proven against the library's own port-contract kit
 * (`iamPolicyStoreContract`) where it is used
 * (extension/__tests__/enterprise-identity.built-in.test.ts), so it is held
 * to the contract every driver is held to rather than to a reading of it.
 * `disconnect` turns every read and write into the rejection an outage is,
 * the kit's fault arm.
 *
 * Edition-neutral by what it imports (the library's barrel and the protos),
 * so the Enterprise identity unit's suites, which publish with it, can use
 * it.
 */
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { DuplicatePolicyError } from "@stigmer/server";
import type { IamPolicyStore } from "@stigmer/server";

/** Principal kinds a scope tuple never names: a person or a team is a grantee, not a link. */
const NON_STRUCTURAL_PRINCIPAL_KINDS: ReadonlySet<string> = new Set(["identity_account", "team"]);
/** Relations a scope tuple never carries: they are roles, not links. */
const NON_STRUCTURAL_RELATIONS: ReadonlySet<string> = new Set(["owner", "creator"]);

export class InMemoryIamPolicyStore implements IamPolicyStore {
  private readonly rows = new Map<string, IamPolicy>();
  private down = false;

  /** Every later call rejects, as a store whose connection is gone does. */
  disconnect(): void {
    this.down = true;
  }

  /** Every held row, in insertion order. */
  all(): ReadonlyArray<IamPolicy> {
    return [...this.rows.values()];
  }

  async save(policy: IamPolicy): Promise<void> {
    this.guard();
    const id = policy.metadata?.id ?? "";
    if (this.rows.has(id)) {
      throw new DuplicatePolicyError(`IAM policy '${id}' already exists`);
    }
    this.rows.set(id, policy);
  }

  async deleteById(id: string): Promise<void> {
    this.guard();
    this.rows.delete(id);
  }

  async findById(id: string): Promise<IamPolicy | undefined> {
    this.guard();
    return this.rows.get(id);
  }

  async findByPrincipal(principalKind: string, principalId: string): Promise<ReadonlyArray<IamPolicy>> {
    return this.where(
      (spec) => spec.principal?.kind === principalKind && spec.principal?.id === principalId,
    );
  }

  async findByResource(resourceKind: string, resourceId: string): Promise<ReadonlyArray<IamPolicy>> {
    return this.where((spec) => onResource(spec, resourceKind, resourceId));
  }

  async findByPrincipalAndResource(
    principalKind: string,
    principalId: string,
    resourceKind: string,
    resourceId: string,
  ): Promise<ReadonlyArray<IamPolicy>> {
    return this.where(
      (spec) =>
        spec.principal?.kind === principalKind &&
        spec.principal?.id === principalId &&
        onResource(spec, resourceKind, resourceId),
    );
  }

  async findByResourceWithRelations(
    resourceKind: string,
    resourceId: string,
    relations: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<IamPolicy>> {
    return this.where(
      (spec) => onResource(spec, resourceKind, resourceId) && relations.includes(spec.relation),
    );
  }

  async countDistinctPrincipalsByResource(
    resourceKind: string,
    resourceId: string,
    principalKind: string | undefined,
    relations: ReadonlyArray<string>,
  ): Promise<number> {
    const rows = await this.findByResourceWithRelations(resourceKind, resourceId, relations);
    const principals = new Set<string>();
    for (const row of rows) {
      const principal = row.spec?.principal;
      if (principal !== undefined && (principalKind === undefined || principal.kind === principalKind)) {
        principals.add(`${principal.kind}:${principal.id}`);
      }
    }
    return principals.size;
  }

  async findScopeTuple(resourceKind: string, resourceId: string): Promise<IamPolicy | undefined> {
    const rows = await this.where(
      (spec) =>
        onResource(spec, resourceKind, resourceId) &&
        !NON_STRUCTURAL_PRINCIPAL_KINDS.has(spec.principal?.kind ?? "") &&
        !NON_STRUCTURAL_RELATIONS.has(spec.relation) &&
        // An edge to itself is never its parent, as in the SQL store's findScopeTuple.
        !(spec.principal?.kind === resourceKind && spec.principal.id === resourceId),
    );
    return rows[0];
  }

  async findByResourceKindAndRelation(resourceKind: string, relation: string): Promise<ReadonlyArray<IamPolicy>> {
    return this.where((spec) => spec.resource?.kind === resourceKind && spec.relation === relation);
  }

  private async where(
    matches: (spec: NonNullable<IamPolicy["spec"]>) => boolean,
  ): Promise<ReadonlyArray<IamPolicy>> {
    this.guard();
    return [...this.rows.values()].filter((row) => row.spec !== undefined && matches(row.spec));
  }

  private guard(): void {
    if (this.down) {
      throw new Error("the in-memory IAM policy store is disconnected");
    }
  }
}

function onResource(spec: NonNullable<IamPolicy["spec"]>, kind: string, id: string): boolean {
  return spec.resource?.kind === kind && spec.resource?.id === id;
}
