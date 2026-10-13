/**
 * Renames: a resource is filed under its minted id, and its slug is a name
 * in the one name table (names.ts), so a rename moves a name and nothing
 * else. Every reference, grant, share and schedule names the resource by
 * id and keeps working; every answer names it by its current slug (the
 * reference fill, pipeline/interceptors/resource-references.ts).
 *
 * What this module gives every renamable kind, organization's protocol
 * (domain/organization/rename.ts) made generic:
 *
 *   - moveName: move an id's current name in one transaction, the old one
 *     held as a previous name; a move lost to a holder that is gone frees
 *     that one name and moves again. The organization rename, a service
 *     account's name change and a vault's external id move call it too,
 *     each with its own hold and refusal;
 *   - RENAMED_NAME_HOLD_MS: how long an old slug keeps leading to the
 *     renamed resource, during which nobody else in the organization can
 *     take it and the resource can take it back. Reads follow it
 *     (findResourceByName); writes are refused (findResourceForWrite);
 *   - the rename chain, every renamable kind's `rename` RPC: Authorize
 *     (can_delete on resource_id), ValidateProto, LoadForRename,
 *     ValidateNewSlug (the kind's create rules for a slug, so a rename
 *     reaches no slug a create could not), RenameName, PersistRenamed.
 *
 * The store has no transaction across the name table and the rows, so the
 * order is chosen for what a failure leaves: the names move first, then
 * the row's slug is written onto the live row inside the store's atomic
 * write (RenameRows.modify), and a failed write moves the names back. Only
 * the slug and the spec audit are written, so a rename never reverts an
 * edit that landed between its load and its write, and the write is
 * followed by a read of the table's current name, so two renames that
 * interleave still leave the row on the name the table holds; every other writer of a
 * renamable kind writes by compare-and-swap on the row it read and runs
 * again when a rename lands in between (pipeline/guarded-write.ts), so the
 * row and the table agree.
 *
 * No search entry holds a slug (a result is built from the live row at
 * query time), and a version's hash covers its spec alone, so a rename
 * re-indexes nothing and mints no version.
 *
 * Proven by __tests__/rename.test.ts and the rename conformance suite.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import type { DescMethodUnary } from "@bufbuild/protobuf";

import type {
  RenameInput,
  RenameInputSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { belongsToAnOrganization } from "../../authorization/credential-binding.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type {
  ResourceNameEntry,
  ResourceNameRename,
  ResourceNameRenamed,
  Store,
} from "../../store/interface.js";
import { getKindName, kindEnumName } from "../apiresource-meta.js";
import { internalError, notFoundError } from "../errors.js";
import { newPipeline } from "../pipeline.js";
import type { PipelineStep } from "../pipeline.js";
import { RequestContext } from "../request-context.js";
import { newAuthorizeStep } from "./authorize.js";
import { setAuditFieldsForUpdate } from "./defaults.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { holderIsGone, nameTakenError, storedRowHolder } from "./names.js";
import type { NameHolder, NameTable } from "./names.js";
import { refuseBoundElsewhere } from "./refuse-bound-elsewhere.js";
import { metadataOf } from "./shapes.js";
import { newValidateProtoStep } from "./validation.js";

type RenameDesc = typeof RenameInputSchema;

/** How long a renamed resource's old slug keeps leading to it: 30 days. */
export const RENAMED_NAME_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Moves `move.id`'s current name to `move.to` (ResourceNameStore.rename).
 * A move lost to a holder that no longer holds the name, once its claim is
 * old enough (names.ts holderIsGone), lets that one name go and moves
 * again; a move lost to a live holder comes back as the entry that holds
 * the name, for the caller's own refusal.
 */
export async function moveName(
  table: NameTable,
  move: ResourceNameRename,
  holder: NameHolder,
): Promise<ResourceNameRenamed> {
  const moved = await table.resourceNames.rename(move);
  if (
    moved.claimed ||
    !(await holderIsGone(moved.entry, new Date(move.now), holder))
  ) {
    return moved;
  }
  await table.resourceNames.releaseName(
    { kind: move.kind, org: move.org, name: move.to },
    moved.entry.id,
  );
  return table.resourceNames.rename(move);
}

/**
 * The rows a rename reads and writes: the store's, or the port of a kind a
 * composition keeps elsewhere (a platform client, a team, an identity
 * provider).
 */
export interface RenameRows<Desc extends DescMessage> {
  readonly schema: Desc;
  /** The row `id` names, or undefined when none does. */
  find(id: string): Promise<MessageShape<Desc> | undefined>;
  /**
   * Applies `modify` to the live row inside one atomic write and answers
   * the written row, or undefined when the row is gone. `modify` is
   * synchronous (Store.updateResource says why).
   */
  modify(
    id: string,
    modify: (row: MessageShape<Desc>) => void,
  ): Promise<MessageShape<Desc> | undefined>;
  /** Whether a name's holder still holds it, for a move lost to a gone holder. */
  readonly holder: NameHolder;
}

/** A kind's rows in the store. */
export function storeRenameRows<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  schema: Desc,
): RenameRows<Desc> {
  return {
    schema,
    async find(id) {
      try {
        return await store.getResource(kind, id, schema);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return undefined;
        }
        throw error;
      }
    },
    async modify(id, modify) {
      try {
        return await store.updateResource(kind, id, schema, modify);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return undefined;
        }
        throw error;
      }
    },
    holder: storedRowHolder(store, kind, schema),
  };
}

/** A kind's rows through a port that reads by id and writes atomically by id. */
export function portRenameRows<Desc extends DescMessage>(
  schema: Desc,
  port: {
    findById(id: string): Promise<MessageShape<Desc> | undefined>;
    modifyById(
      id: string,
      modify: (row: MessageShape<Desc>) => void,
    ): Promise<MessageShape<Desc> | undefined>;
  },
): RenameRows<Desc> {
  return {
    schema,
    find: (id) => port.findById(id),
    modify: (id, modify) => port.modifyById(id, modify),
    holder: {
      holds: async (entry) => (await port.findById(entry.id)) !== undefined,
    },
  };
}

/** Where the chain keeps the resource it renamed, and returns. */
export const RENAMED_RESOURCE_KEY = "renamedResource";

/** Where RenameName leaves the move it made, for the write that follows. */
const NAME_MOVE_KEY = "resourceNameMove";

/** The move RenameName made, and the earlier state of a name it took back. */
interface NameMove {
  readonly move: ResourceNameRename;
  readonly takenBack?: ResourceNameEntry;
}

/**
 * LoadForRename: the row `resource_id` names, into EXISTING_RESOURCE_KEY,
 * where a kind's own refusals read it (a system-managed client). A missing
 * one answers NotFound naming the id, a store fault Internal.
 */
export function newLoadForRenameStep<Desc extends DescMessage>(
  rows: RenameRows<Desc>,
): PipelineStep<RenameDesc> {
  return {
    name: "LoadForRename",
    async execute(ctx: RequestContext<RenameDesc>): Promise<void> {
      let row: MessageShape<Desc> | undefined;
      try {
        row = await rows.find(ctx.input.resourceId);
      } catch (error) {
        throw internalError(
          error,
          `failed to load ${kindEnumName(ctx.apiResourceKind)}`,
        );
      }
      if (row === undefined) {
        throw notFoundError(
          getKindName(ctx.apiResourceKind),
          ctx.input.resourceId,
        );
      }
      ctx.set(EXISTING_RESOURCE_KEY, row);
    },
  };
}

/**
 * The kind's own rules for a slug, the ones its create runs (a vault's My
 * vault prefix, a platform client's reserved slug), and any refusal of the
 * loaded resource's rename (My vault is named after its person). Throws
 * the kind's refusal.
 */
export type NewSlugRule<Desc extends DescMessage> = (
  resource: MessageShape<Desc>,
  slug: string,
) => void;

/** ValidateNewSlug: the kind's NewSlugRule, so a rename reaches no slug a create could not. */
export function newValidateNewSlugStep<Desc extends DescMessage>(
  rule: NewSlugRule<Desc> | undefined,
): PipelineStep<RenameDesc> {
  return {
    name: "ValidateNewSlug",
    execute(ctx: RequestContext<RenameDesc>): void {
      rule?.(
        ctx.get(EXISTING_RESOURCE_KEY) as MessageShape<Desc>,
        ctx.input.slug,
      );
    },
  };
}

/**
 * RenameName: moves the resource's name in the table. The table, not the
 * row, says what the resource is called now. A rename to that name
 * changes nothing; any other moves the name (moveName), the old one held
 * for RENAMED_NAME_HOLD_MS, and a slug another resource of the kind holds
 * is refused as a create of it is (names.ts nameTakenError). A credential
 * bound to another organization is refused before anything moves, as
 * Persist refuses one.
 */
export function newRenameNameStep<Desc extends DescMessage>(
  names: NameTable,
  rows: RenameRows<Desc>,
): PipelineStep<RenameDesc> {
  return {
    name: "RenameName",
    async execute(ctx: RequestContext<RenameDesc>): Promise<void> {
      const resource = ctx.get(EXISTING_RESOURCE_KEY) as MessageShape<Desc>;
      const metadata = metadataOf(resource);
      const kind = ctx.apiResourceKind;
      if (
        metadata === undefined ||
        metadata.id === "" ||
        metadata.slug === ""
      ) {
        throw internalError(
          new Error(`${kindEnumName(kind)} row has no id or slug`),
          "failed to rename the resource",
        );
      }
      if (belongsToAnOrganization(kind)) {
        refuseBoundElsewhere(ctx.callerIdentity, metadata.org);
      }
      let current;
      try {
        current = await names.resourceNames.current(
          kindEnumName(kind),
          metadata.org,
          metadata.id,
        );
      } catch (error) {
        throw internalError(error, "failed to rename the resource");
      }
      const from = current?.name ?? metadata.slug;
      if (from === ctx.input.slug) {
        metadata.slug = from;
        ctx.set(RENAMED_RESOURCE_KEY, resource);
        return;
      }
      const now = new Date();
      const move: ResourceNameRename = {
        kind: kindEnumName(kind),
        org: metadata.org,
        id: metadata.id,
        from,
        to: ctx.input.slug,
        fromExpiresAt: new Date(
          now.getTime() + RENAMED_NAME_HOLD_MS,
        ).toISOString(),
        now: now.toISOString(),
      };
      let moved: ResourceNameRenamed;
      try {
        moved = await moveName(names, move, rows.holder);
      } catch (error) {
        throw internalError(error, "failed to rename the resource");
      }
      if (!moved.claimed) {
        throw nameTakenError(kind, moved.entry);
      }
      const recorded: NameMove =
        moved.takenBack === undefined
          ? { move }
          : { move, takenBack: moved.takenBack };
      ctx.set(NAME_MOVE_KEY, recorded);
    },
  };
}

/**
 * PersistRenamed: writes the new slug and the spec audit (event
 * "renamed") onto the live row, inside one atomic write, and nothing
 * else. When the write fails, or the row is gone, the names move back; a
 * failed move back is logged, and leaves both slugs leading to the
 * resource until a retry, which converges because the new slug is already
 * its own.
 */
export function newPersistRenamedStep<Desc extends DescMessage>(
  names: NameTable,
  rows: RenameRows<Desc>,
  logger: Logger,
): PipelineStep<RenameDesc> {
  return {
    name: "PersistRenamed",
    async execute(ctx: RequestContext<RenameDesc>): Promise<void> {
      const recorded = ctx.get(NAME_MOVE_KEY) as NameMove | undefined;
      if (recorded === undefined) {
        return; // the slug was already the resource's
      }
      const { move, takenBack } = recorded;
      const identity = ctx.callerIdentity;
      let written: MessageShape<Desc> | undefined;
      let failure: unknown;
      try {
        written = await rows.modify(move.id, (row) => {
          const metadata = metadataOf(row);
          if (metadata !== undefined) {
            metadata.slug = move.to;
          }
          setAuditFieldsForUpdate(
            rows.schema,
            row,
            "spec_audit",
            identity,
            "renamed",
          );
        });
      } catch (error) {
        failure = error;
      }
      if (written !== undefined) {
        ctx.set(
          RENAMED_RESOURCE_KEY,
          await settleOnTable(names, rows, move, written, logger),
        );
        return;
      }
      try {
        await names.resourceNames.revertRename(move, takenBack);
      } catch (revertError) {
        logger.error(
          "rename failed and its names could not be moved back; both slugs lead to the resource until a retry",
          {
            kind: move.kind,
            id: move.id,
            from: move.from,
            to: move.to,
            error:
              revertError instanceof Error
                ? revertError.message
                : String(revertError),
          },
        );
      }
      if (failure === undefined) {
        throw notFoundError(getKindName(ctx.apiResourceKind), move.id);
      }
      throw internalError(failure, "failed to save the renamed resource");
    },
  };
}

/**
 * Brings the renamed row to the name the table holds as its current one.
 * Two renames of one resource can interleave: each moves the table, then
 * writes the row, and the later table move may land its row write first.
 * So the write is followed by a read of the current name, and a row left
 * behind it is written once more with that name, so the row and the table
 * agree. Best-effort: a fault is logged and the row is answered as it
 * stands; the next rename settles it.
 */
async function settleOnTable<Desc extends DescMessage>(
  names: NameTable,
  rows: RenameRows<Desc>,
  move: ResourceNameRename,
  written: MessageShape<Desc>,
  logger: Logger,
): Promise<MessageShape<Desc>> {
  try {
    const current = await names.resourceNames.current(
      move.kind,
      move.org,
      move.id,
    );
    if (current === undefined || current.name === metadataOf(written)?.slug) {
      return written;
    }
    const settled = await rows.modify(move.id, (row) => {
      const metadata = metadataOf(row);
      if (metadata !== undefined) {
        metadata.slug = current.name;
      }
    });
    return settled ?? written;
  } catch (error) {
    logger.warn(
      "renamed row may lag its current name; the next rename settles it",
      {
        kind: move.kind,
        id: move.id,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return written;
  }
}

/** What a kind's rename chain is built from. */
export interface RenameChain<Desc extends DescMessage> {
  /** The kind's `rename` method, whose annotation Authorize evaluates. */
  readonly method: DescMethodUnary<RenameDesc, Desc>;
  readonly names: NameTable;
  readonly rows: RenameRows<Desc>;
  readonly authorizer: Authorizer;
  readonly logger: Logger;
  /** The kind's slug rules (ValidateNewSlug); absent for a kind with none. */
  readonly newSlugRule?: NewSlugRule<Desc>;
  /** The kind's own refusals of the caller, run after ValidateProto and before the load. */
  readonly beforeLoad?: ReadonlyArray<PipelineStep<RenameDesc>>;
  /** The kind's own refusals of the loaded resource, run after LoadForRename. */
  readonly afterLoad?: ReadonlyArray<PipelineStep<RenameDesc>>;
}

/**
 * Runs a kind's rename chain and answers the renamed resource, as the
 * store holds it after the write. The response is the caller's to redact,
 * as its other answers are.
 */
export async function renameResource<Desc extends DescMessage>(
  chain: RenameChain<Desc>,
  input: RenameInput,
  caller: CallerIdentity,
  kind: ApiResourceKind,
): Promise<MessageShape<Desc>> {
  const ctx = new RequestContext(chain.method.input, input, caller, kind);
  const builder = newPipeline<RenameDesc>(
    `${kindEnumName(kind).replaceAll("_", "")}-rename`,
    chain.logger,
  )
    .addStep(newAuthorizeStep(chain.method, chain.authorizer))
    .addStep(newValidateProtoStep());
  for (const step of chain.beforeLoad ?? []) {
    builder.addStep(step);
  }
  builder.addStep(newLoadForRenameStep(chain.rows));
  for (const step of chain.afterLoad ?? []) {
    builder.addStep(step);
  }
  await builder
    .addStep(newValidateNewSlugStep(chain.newSlugRule))
    .addStep(newRenameNameStep(chain.names, chain.rows))
    .addStep(newPersistRenamedStep(chain.names, chain.rows, chain.logger))
    .build()
    .execute(ctx);
  return ctx.get(RENAMED_RESOURCE_KEY) as MessageShape<Desc>;
}
