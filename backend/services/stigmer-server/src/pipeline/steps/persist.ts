/**
 * Persist — ports steps/persist.go: saves newState through the store
 * (metadata.id must be set by an earlier step). A credential bound to one
 * organization saves no row filed in another (refuse-bound-elsewhere.ts):
 * the backstop under every lane's own check. Only a kind whose rows belong
 * to an organization is judged by `metadata.org`; an API key, owner-only,
 * is judged by the organization it is limited to, which the binding reads
 * itself (authorization/credential-binding.ts).
 *
 * `save` replaces the store's own upsert for a kind whose creation must
 * commit with more than the row (a run's, which appends its session's
 * events in the same transaction, domain/session/events/run-writes.ts);
 * the step's name and place in the chain are the same either way.
 *
 * An update persists by compare-and-swap on the bytes LoadExisting read
 * (EXISTING_RESOURCE_BYTES_KEY): the new state was built from that row
 * across awaited steps, and a status write, a rename or another person's
 * edit may have landed since. A lost swap throws writeConflictError, and
 * the controller's runGuardedWrite runs the chain again from a fresh read
 * (pipeline/guarded-write.ts). A create, which loaded nothing, saves.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { GuardedWritePort } from "../../store/guarded-port.js";
import type { Store } from "../../store/interface.js";
import { internalError } from "../errors.js";
import { writeConflictError } from "../guarded-write.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { belongsToAnOrganization } from "../../authorization/credential-binding.js";
import { EXISTING_RESOURCE_BYTES_KEY } from "./load-existing.js";
import { refuseBoundElsewhere } from "./refuse-bound-elsewhere.js";
import { metadataOf } from "./shapes.js";

/**
 * The Internal copy of a store fault on a write; a kind whose write had its
 * own copy passes it to the helpers below, since error copy is wire
 * contract.
 */
const SAVE_FAILURE = "failed to save resource to store";

export function newPersistStep<Desc extends DescMessage>(
  store: Store,
  save?: (state: MessageShape<Desc>) => Promise<void>,
): PipelineStep<Desc> {
  return {
    name: "Persist",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(new Error("resource metadata is nil"), "persist");
      }
      if (metadata.id === "") {
        throw internalError(
          new Error("resource ID is empty, cannot persist"),
          "persist",
        );
      }
      if (belongsToAnOrganization(ctx.apiResourceKind)) {
        refuseBoundElsewhere(ctx.callerIdentity, metadata.org);
      }
      if (ctx.get(EXISTING_RESOURCE_BYTES_KEY) !== undefined) {
        await swapOntoLoadedRow(store, ctx);
        return;
      }
      try {
        await (save === undefined
          ? store.saveResource(
              ctx.apiResourceKind,
              metadata.id,
              ctx.schema,
              ctx.newState,
            )
          : save(ctx.newState));
      } catch (error) {
        throw internalError(error, SAVE_FAILURE);
      }
    },
  };
}

/**
 * An update chain's write: the new state stored by compare-and-swap on the
 * bytes LoadExisting read (EXISTING_RESOURCE_BYTES_KEY). A row that moved
 * or was deleted since the read loses the swap and throws
 * writeConflictError, which runGuardedWrite retries from a fresh read.
 * Persist calls it, and so does a kind whose update persists under its own
 * step name.
 */
export async function swapOntoLoadedRow<Desc extends DescMessage>(
  store: Store,
  ctx: RequestContext<Desc>,
  failure = SAVE_FAILURE,
): Promise<void> {
  const loadedBytes = ctx.get(EXISTING_RESOURCE_BYTES_KEY);
  const metadata = metadataOf(ctx.newState);
  if (!(loadedBytes instanceof Uint8Array) || metadata === undefined) {
    throw internalError(
      new Error(
        "the loaded row's bytes are not in context - LoadExisting must run first",
      ),
      "persist",
    );
  }
  let landed: boolean;
  try {
    landed = await store.swapResource(
      ctx.apiResourceKind,
      metadata.id,
      ctx.schema,
      loadedBytes,
      ctx.newState,
    );
  } catch (error) {
    throw internalError(error, failure);
  }
  if (!landed) {
    throw writeConflictError(ctx.apiResourceKind, metadata.org, metadata.slug);
  }
}

/**
 * swapOntoLoadedRow for a kind kept outside the shared store: the new
 * state stored through the port's guarded write (store/guarded-port.ts) on
 * the bytes the chain's loader read with `readForWrite` and kept under
 * EXISTING_RESOURCE_BYTES_KEY. A lost swap throws writeConflictError.
 */
export async function swapOntoLoadedPortRow<Desc extends DescMessage>(
  port: GuardedWritePort<MessageShape<Desc>>,
  ctx: RequestContext<Desc>,
  failure = SAVE_FAILURE,
): Promise<void> {
  const loadedBytes = ctx.get(EXISTING_RESOURCE_BYTES_KEY);
  const metadata = metadataOf(ctx.newState);
  if (!(loadedBytes instanceof Uint8Array) || metadata === undefined) {
    throw internalError(
      new Error(
        "the loaded row's bytes are not in context - the chain's loader must read for a write",
      ),
      "persist",
    );
  }
  let landed: boolean;
  try {
    landed = await port.swap(metadata.id, loadedBytes, ctx.newState);
  } catch (error) {
    throw internalError(error, failure);
  }
  if (!landed) {
    throw writeConflictError(ctx.apiResourceKind, metadata.org, metadata.slug);
  }
}

/**
 * The write of a chain whose resource rides a context key rather than its
 * new state (a push): stored by compare-and-swap on the bytes its loader
 * kept under EXISTING_RESOURCE_BYTES_KEY when it found one, else saved as
 * new. A lost swap throws writeConflictError.
 */
export async function storeLoadedOrNew<
  Desc extends DescMessage,
  RequestDesc extends DescMessage,
>(
  store: Store,
  ctx: RequestContext<RequestDesc>,
  schema: Desc,
  resource: MessageShape<Desc>,
  failure = SAVE_FAILURE,
): Promise<void> {
  const metadata = metadataOf(resource);
  const id = metadata?.id ?? "";
  const loadedBytes = ctx.get(EXISTING_RESOURCE_BYTES_KEY);
  let landed = true;
  try {
    if (loadedBytes instanceof Uint8Array) {
      landed = await store.swapResource(
        ctx.apiResourceKind,
        id,
        schema,
        loadedBytes,
        resource,
      );
    } else {
      await store.saveResource(ctx.apiResourceKind, id, schema, resource);
    }
  } catch (error) {
    throw internalError(error, failure);
  }
  if (!landed) {
    throw writeConflictError(
      ctx.apiResourceKind,
      metadata?.org ?? "",
      metadata?.slug ?? "",
    );
  }
}
