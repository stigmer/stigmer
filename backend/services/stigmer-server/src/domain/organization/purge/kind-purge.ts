/**
 * A kind's purge: every row of one kind that an organization being
 * deleted owns, removed with the cleanup the kind's own delete chain
 * does, and none of its refusals.
 *
 * Why the delete chain's steps and not its RPC. A kind's delete chain
 * carries the cleanup a purge needs (its version archives, its secret
 * backing state, its schedule artifacts, its shares and executions, its
 * search entry, its access), and refusals a purge must not meet: a session
 * with an active execution, a plugin-managed member, a plugin whose members
 * something references. Inside a purge every reference is going too, and
 * the RPC would refuse in orders nobody can always satisfy, so each kind's
 * purge (`src/domain/<kind>/purge.ts`) lists the cleanup steps of its
 * delete chain, built from the same factories, and this module runs them
 * over each row as the delete chain would have after its load:
 * `RESOURCE_ID_KEY` and `EXISTING_RESOURCE_KEY` set, the purge's caller
 * stamped.
 *
 * Before the steps, every policy row naming the row is revoked through the
 * grant path, failing the batch on a fault. A delete chain's
 * CleanupIamPolicies is best-effort (it logs and lets the delete answer);
 * a purge must leave nothing, and it is retried, so it fails instead. The
 * revocation comes first because the row is how a retry finds what is
 * left, and how the grant path resolves the row's organization: a fault
 * after the row's delete would leave policy rows nothing could reach. The
 * same rule orders each kind's own removals (blobs before the row that
 * names them).
 *
 * Rows are found where the store keeps them: through the kind's list index
 * when it has one (one organization's rows, a bounded page), otherwise by
 * reading the kind in keyset pages and decoding each row's organization,
 * the migrations' precedent (store/organization-slug-history.ts); the kinds
 * without a list index hold few rows (boot/list-indexes.ts says how few).
 * A kind may name its organization elsewhere than `metadata.org` (an API
 * key bound to one), through `belongsTo`; a kind whose rows live behind a
 * port a composition may substitute reads them through it (`rows`).
 *
 * What the tests pin (__tests__/kind-purge.test.ts): only the
 * organization's rows go, a batch answers whether more are left, the steps
 * see the loaded row, and a policy fault fails the batch.
 */
import type { DescMessage, Message, MessageShape } from "@bufbuild/protobuf";
import { create, fromBinary } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { Logger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { OrganizationPurgeTarget } from "../../../extensions/organization-purge.js";
import { kindEnumName } from "../../../pipeline/apiresource-meta.js";
import { newPipeline } from "../../../pipeline/pipeline.js";
import type { PipelineStep } from "../../../pipeline/pipeline.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { metadataOf } from "../../../pipeline/steps/shapes.js";
import type { Store } from "../../../store/interface.js";
import type { ListIndexDeclaration } from "../../../store/list-index.js";
import type { IamPolicyGrantPath } from "../../iampolicy/grant-path.js";

/** How many rows of a kind one batch removes. */
export const KIND_PURGE_BATCH = 50;

/** How many rows a keyset page reads when a kind has no list index. */
const SCAN_PAGE = 200;

/** One kind's purge, as the content stage runs it. */
export interface KindPurge {
  readonly kind: ApiResourceKind;
  /** Removes up to `limit` of the organization's rows; `more` when rows are left. */
  purge(
    org: OrganizationPurgeTarget,
    caller: CallerIdentity,
    limit?: number,
  ): Promise<{ readonly more: boolean }>;
  /** Whether the organization still owns a row of the kind (the census's and the tests' question). */
  holdsAny(org: OrganizationPurgeTarget): Promise<boolean>;
}

/** What every kind purge reads and writes through. */
export interface KindPurgeDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The one grant path: each removed row's policy rows are revoked through it. */
  readonly grantPath: Pick<IamPolicyGrantPath, "cleanupResource">;
}

export interface KindPurgeSpec<
  Input extends DescMessage,
  Resource extends DescMessage,
> {
  readonly kind: ApiResourceKind;
  /** The kind's resource message. */
  readonly schema: Resource;
  /** The kind's delete RPC input (the id wrapper its delete chain's steps are typed on). */
  readonly input: Input;
  /** The kind's list index, when it has one. */
  readonly listIndex?: ListIndexDeclaration;
  /**
   * Whether a row is the organization's; defaults to `metadata.org`. A kind
   * that names its organization elsewhere says where.
   */
  readonly belongsTo?: (
    row: MessageShape<Resource>,
    org: OrganizationPurgeTarget,
  ) => boolean;
  /**
   * Reads the organization's rows itself, at most `limit`: a kind whose rows
   * live behind a port a composition may substitute (a PlatformClient's),
   * so the purge follows the composed store.
   */
  readonly rows?: (
    org: OrganizationPurgeTarget,
    limit: number,
  ) => Promise<ReadonlyArray<MessageShape<Resource>>>;
  /** The delete chain's cleanup steps, in its order, its DeleteResource included. */
  readonly steps: ReadonlyArray<PipelineStep<Input>>;
}

export function newKindPurge<
  Input extends DescMessage,
  Resource extends DescMessage,
>(deps: KindPurgeDeps, spec: KindPurgeSpec<Input, Resource>): KindPurge {
  const pipelineName = `${kindEnumName(spec.kind)}-purge`;
  const belongsTo =
    spec.belongsTo ??
    ((row: MessageShape<Resource>, org: OrganizationPurgeTarget) =>
      (metadataOf(row as Message)?.org ?? "") === org.id);

  async function rowsOf(
    org: OrganizationPurgeTarget,
    limit: number,
  ): Promise<ReadonlyArray<MessageShape<Resource>>> {
    if (spec.rows !== undefined) {
      return (await spec.rows(org, limit)).slice(0, limit);
    }
    if (spec.listIndex !== undefined && spec.belongsTo === undefined) {
      const rows = await deps.store.queryResources(spec.listIndex, {
        org: org.id,
        limit,
      });
      return rows
        .map((row) => fromBinary(spec.schema, row.data))
        .filter((row) => belongsTo(row, org));
    }
    const found: Array<MessageShape<Resource>> = [];
    let after = "";
    for (;;) {
      const page = await deps.store.findResourcesRawOrderedAfter(
        spec.kind,
        after,
        SCAN_PAGE,
      );
      for (const raw of page) {
        const row = fromBinary(spec.schema, raw.data);
        if (belongsTo(row, org)) {
          found.push(row);
          if (found.length >= limit) {
            return found;
          }
        }
      }
      if (page.length < SCAN_PAGE) {
        return found;
      }
      after = page[page.length - 1]!.id;
    }
  }

  async function removeRow(
    row: MessageShape<Resource>,
    caller: CallerIdentity,
  ): Promise<void> {
    const id = metadataOf(row as Message)?.id ?? "";
    if (id === "") {
      throw new Error(
        `a ${kindEnumName(spec.kind)} row with no id cannot be purged`,
      );
    }
    const ctx = new RequestContext(
      spec.input,
      create(spec.input),
      caller,
      spec.kind,
    );
    ctx.set(RESOURCE_ID_KEY, id);
    ctx.set(EXISTING_RESOURCE_KEY, row);
    await deps.grantPath.cleanupResource(
      create(ApiResourceRefSchema, { kind: kindEnumName(spec.kind), id }),
      caller,
    );
    const builder = newPipeline<Input>(pipelineName, deps.logger);
    for (const step of spec.steps) {
      builder.addStep(step);
    }
    await builder.build().execute(ctx);
  }

  return {
    kind: spec.kind,
    async purge(org, caller, limit = KIND_PURGE_BATCH) {
      const rows = await rowsOf(org, limit + 1);
      for (const row of rows.slice(0, limit)) {
        await removeRow(row, caller);
      }
      return { more: rows.length > limit };
    },
    async holdsAny(org) {
      return (await rowsOf(org, 1)).length > 0;
    },
  };
}
