/**
 * The push steps every kind pushed as a folder shares (plugins, evals):
 * the archive gate, upsert by slug, the id, the level, the no-op decision,
 * the content-addressed store, the name claim, the one write and the
 * tuples. Each kind keeps only what reads its content (a plugin's manifest
 * and status plan, an eval's cases) and builds its chain from these in the
 * same order:
 *
 *   plan:    … → GateAndHashArchive → <read the content> → <build the head>
 *            → FindExistingBySlug → <authorize> → RefuseRenamedSlug →
 *            GenerateIDIfNeeded →
 *            <plan> → Guard<Kind>Visibility → ResolveConvergence
 *   install: … → CheckAndStoreArtifact → <populate the head> → ClaimName →
 *            Store<Kind> → <archive the version> → <Kind>PushAuthorizationTuples
 *
 * A push is the kind's create and its update in one request, so a chain
 * carries one head under PUSHED_RESOURCE_KEY, the row it found under
 * EXISTING_PUSHED_RESOURCE_KEY, and whether it creates under
 * SHOULD_CREATE_KEY; the controller returns the stored head when
 * ResolveConvergence finds the push already true and skips the install
 * chain. Every step reads the kind from `ctx.apiResourceKind`; the binding
 * names its schema, its noun in sentences and the level a push writes.
 * The plugin's and the eval's pushes run these steps; the skill's push is
 * its own chain with its own steps.
 *
 * Proven by the plugin domain's __tests__/plugin.test.ts and the eval
 * domain's __tests__/eval.test.ts (composed-server round trips), and the
 * plugin and eval conformance suites.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import type { ContentAddressedArchiveStore } from "../../archive/content-store.js";
import { openArchiveFiles } from "../../archive/open-files.js";
import type { OpenedArchive } from "../../archive/open-files.js";
import type { Logger } from "../../boot/logger.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ResourceReadForWrite, Store } from "../../store/interface.js";
import { getIdPrefix } from "../apiresource-meta.js";
import { internalError, invalidArgumentError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import {
  diffVisibilityShapes,
  resolveResourceCreatedEvent,
} from "./authorization-tuples.js";
import { generateId } from "./defaults.js";
import { EXISTING_RESOURCE_BYTES_KEY } from "./load-existing.js";
import { claimNameOf, resolveNameEntry, slugRenamedError } from "./names.js";
import { storeLoadedOrNew } from "./persist.js";
import { ARTIFACT_BYTES_KEY } from "./resolve-artifact-source.js";
import { metadataOf } from "./shapes.js";
import {
  refuseChildOrgsVisibilityInChild,
  rejectUnsupportedVisibility,
} from "./validate-visibility.js";

/** The gated archive (OpenedArchive): its digest and its files. */
export const OPENED_ARCHIVE_KEY = "openedArchive";
/** The head this push writes. */
export const PUSHED_RESOURCE_KEY = "pushedResource";
/** The stored row the slug names, or undefined when the push creates. */
export const EXISTING_PUSHED_RESOURCE_KEY = "existingPushedResource";
/** The id of the resource the request's slug was renamed away from, or undefined. */
export const RENAMED_AWAY_ID_KEY = "renamedAwayId";
/** Whether this push creates the resource. */
export const SHOULD_CREATE_KEY = "shouldCreatePushedResource";
/** Whether the stored row already is this push, so the install chain is skipped. */
export const CONVERGED_KEY = "pushConverged";
/** The archive's storage key once CheckAndStoreArtifact ran. */
export const ARTIFACT_STORAGE_KEY_KEY = "artifactStorageKey";

/** The kind a step writes or reads, for the steps that read nothing of the request. */
export interface PushedKind<Res extends DescMessage> {
  readonly schema: Res;
  /** The noun in sentences: "plugin", "eval". */
  readonly noun: string;
}

/** What a kind pushed as a folder says about itself to the shared steps. */
export interface ArchivePushBinding<
  Res extends DescMessage,
  Req extends DescMessage,
> extends PushedKind<Res> {
  /** The level this push writes, the request's or the one it falls back to. */
  visibilityOf(ctx: RequestContext<Req>): ApiResourceVisibility;
  /** The stored head's content digest. */
  digestOf(resource: MessageShape<Res>): string;
  /**
   * Whatever else the request asks of the stored head (an eval's tag and
   * display name), beyond its digest and level; absent, nothing.
   */
  alreadyAsRequested?(existing: MessageShape<Res>, ctx: RequestContext<Req>): boolean;
}

/**
 * GateAndHashArchive — the ZIP gate over the shared archive plumbing: size
 * ceiling, hash, prefilter, structural budgets, and the lazy reader the
 * library reads through. Every gate failure is one InvalidArgument arm.
 */
export function newGateAndHashArchiveStep<Req extends DescMessage>(
  noun: string,
): PipelineStep<Req> {
  return {
    name: "GateAndHashArchive",
    execute(ctx: RequestContext<Req>): void {
      const bytes = ctx.get(ARTIFACT_BYTES_KEY) as Uint8Array;
      let archive: OpenedArchive;
      try {
        archive = openArchiveFiles(bytes, noun);
      } catch (error) {
        throw invalidArgumentError(
          `failed to read ${noun} archive: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      ctx.set(OPENED_ARCHIVE_KEY, archive);
    },
  };
}

/**
 * FindExistingBySlug — push is upsert by slug: the row the head's slug
 * names lends the head its id, and its exact bytes are what the write
 * swaps on (storeLoadedOrNew). A slug the kind's resource was renamed away
 * from is recorded under RENAMED_AWAY_ID_KEY with the id it leads to, and
 * RefuseRenamedSlug refuses it after the chain's authorization, so a
 * caller who may not write that resource learns nothing about its rename;
 * a push that followed the old slug would make a second resource once the
 * hold ends.
 */
export function newFindExistingBySlugStep<
  Res extends DescMessage,
  Req extends DescMessage,
>(store: Store, binding: PushedKind<Res>): PipelineStep<Req> {
  return {
    name: "FindExistingBySlug",
    async execute(ctx: RequestContext<Req>): Promise<void> {
      const head = ctx.get(PUSHED_RESOURCE_KEY) as MessageShape<Res>;
      const metadata = metadataOf(head);
      const org = metadata?.org ?? "";
      const slug = metadata?.slug ?? "";
      const failure = `failed to search for existing ${binding.noun}`;
      let entry: Awaited<ReturnType<typeof resolveNameEntry>>;
      try {
        entry = await resolveNameEntry(store, ctx.apiResourceKind, org, slug);
      } catch (error) {
        throw internalError(error, failure);
      }
      ctx.set(RENAMED_AWAY_ID_KEY, entry?.state === "previous" ? entry.id : undefined);
      let found: ResourceReadForWrite<Res> | undefined;
      if (entry !== undefined && entry.state !== "previous") {
        try {
          found = await store.readResourceForWrite(ctx.apiResourceKind, entry.id, binding.schema);
        } catch (error) {
          if (!(error instanceof ResourceNotFoundError)) {
            throw internalError(error, failure);
          }
        }
      }
      if (found !== undefined) {
        const existingMetadata = metadataOf(found.resource);
        if (metadata !== undefined) {
          metadata.id = existingMetadata?.id ?? "";
        }
        ctx.set(EXISTING_RESOURCE_BYTES_KEY, found.bytes);
        ctx.set(EXISTING_PUSHED_RESOURCE_KEY, found.resource);
        ctx.set(SHOULD_CREATE_KEY, false);
      } else {
        ctx.set(EXISTING_PUSHED_RESOURCE_KEY, undefined);
        ctx.set(SHOULD_CREATE_KEY, true);
      }
    },
  };
}

/**
 * RefuseRenamedSlug — a push naming a slug its kind's resource was renamed
 * away from is refused with SLUG_RENAMED, as every write's lookup refuses
 * it. Runs after the chain's authorization (a kind that authorizes on the
 * request runs it right after FindExistingBySlug).
 */
export function newRefuseRenamedSlugStep<Req extends DescMessage>(): PipelineStep<Req> {
  return {
    name: "RefuseRenamedSlug",
    execute(ctx: RequestContext<Req>): void {
      if (ctx.get(RENAMED_AWAY_ID_KEY) === undefined) {
        return;
      }
      const head = ctx.get(PUSHED_RESOURCE_KEY) as MessageShape<DescMessage>;
      throw slugRenamedError(ctx.apiResourceKind, metadataOf(head)?.slug ?? "");
    },
  };
}

/** GenerateIDIfNeeded — a new resource mints `<prefix>_{ulid}`; an existing one keeps its id. */
export function newGenerateIdIfNeededStep<Req extends DescMessage>(): PipelineStep<Req> {
  return {
    name: "GenerateIDIfNeeded",
    execute(ctx: RequestContext<Req>): void {
      if (ctx.get(SHOULD_CREATE_KEY) !== true) {
        return;
      }
      const metadata = metadataOf(ctx.get(PUSHED_RESOURCE_KEY) as MessageShape<DescMessage>);
      if (metadata !== undefined) {
        metadata.id = generateId(getIdPrefix(ctx.apiResourceKind));
      }
    },
  };
}

/**
 * Guard<Kind>Visibility — the requested level must be one the kind
 * supports, and a child organization may not share with child
 * organizations: the push chain's counterpart of the ValidateVisibility
 * step on the resource create chains, asked before anything is written.
 */
export function newGuardPushVisibilityStep<
  Res extends DescMessage,
  Req extends DescMessage,
>(
  store: Store,
  binding: ArchivePushBinding<Res, Req>,
  stepName: string,
): PipelineStep<Req> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<Req>): Promise<void> {
      const level = binding.visibilityOf(ctx);
      rejectUnsupportedVisibility(ctx.apiResourceKind, level);
      const head = ctx.get(PUSHED_RESOURCE_KEY) as MessageShape<Res>;
      await refuseChildOrgsVisibilityInChild(store, metadataOf(head)?.org ?? "", level);
    },
  };
}

/**
 * ResolveConvergence — the no-op decision: the stored row already IS this
 * push when its digest and its level match, and whatever else the kind
 * reads from the request (`alreadyAsRequested`). Anything less installs.
 */
export function newResolveConvergenceStep<
  Res extends DescMessage,
  Req extends DescMessage,
>(binding: ArchivePushBinding<Res, Req>): PipelineStep<Req> {
  return {
    name: "ResolveConvergence",
    execute(ctx: RequestContext<Req>): void {
      const existing = ctx.get(EXISTING_PUSHED_RESOURCE_KEY) as MessageShape<Res> | undefined;
      const archive = ctx.get(OPENED_ARCHIVE_KEY) as OpenedArchive;
      const converged =
        existing !== undefined &&
        binding.digestOf(existing) === archive.digest &&
        (metadataOf(existing)?.visibility ??
          ApiResourceVisibility.api_resource_visibility_unspecified) ===
          binding.visibilityOf(ctx) &&
        (binding.alreadyAsRequested?.(existing, ctx) ?? true);
      ctx.set(CONVERGED_KEY, converged);
    },
  };
}

/** CheckAndStoreArtifact — content-addressed dedupe: the same digest reuses the stored copy. */
export function newCheckAndStoreArtifactStep<Req extends DescMessage>(
  artifactStorage: ContentAddressedArchiveStore,
): PipelineStep<Req> {
  return {
    name: "CheckAndStoreArtifact",
    async execute(ctx: RequestContext<Req>): Promise<void> {
      const bytes = ctx.get(ARTIFACT_BYTES_KEY) as Uint8Array;
      const archive = ctx.get(OPENED_ARCHIVE_KEY) as OpenedArchive;
      let exists: boolean;
      try {
        exists = await artifactStorage.exists(archive.digest);
      } catch (error) {
        throw internalError(error, "failed to check artifact existence");
      }
      let storageKey: string;
      if (exists) {
        storageKey = artifactStorage.getStorageKey(archive.digest);
      } else {
        try {
          storageKey = await artifactStorage.store(archive.digest, bytes);
        } catch (error) {
          throw internalError(error, "failed to store artifact");
        }
      }
      ctx.set(ARTIFACT_STORAGE_KEY_KEY, storageKey);
    },
  };
}

/**
 * ClaimName — a pushed resource that is new claims its slug in the name
 * table immediately before its write (names.ts), as a skill push does; a
 * re-push keeps the name its resource holds. The controller ends the
 * install chain with releaseNameOnFailure.
 */
export function newClaimPushedNameStep<
  Res extends DescMessage,
  Req extends DescMessage,
>(store: Store, binding: PushedKind<Res>): PipelineStep<Req> {
  return {
    name: "ClaimName",
    async execute(ctx: RequestContext<Req>): Promise<void> {
      if (ctx.get(SHOULD_CREATE_KEY) !== true) {
        return;
      }
      await claimNameOf(
        ctx,
        store,
        ctx.apiResourceKind,
        ctx.get(PUSHED_RESOURCE_KEY) as MessageShape<Res>,
        binding.schema,
      );
    },
  };
}

/**
 * Store<Kind> — the install's one write: a re-push by compare-and-swap on
 * the row FindExistingBySlug read, so a visibility change or another push
 * that lands in between makes the push run again from a fresh read
 * (pipeline/guarded-write.ts); a first push as new.
 */
export function newStorePushedStep<
  Res extends DescMessage,
  Req extends DescMessage,
>(
  store: Store,
  binding: PushedKind<Res>,
  stepName: string,
): PipelineStep<Req> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<Req>): Promise<void> {
      await storeLoadedOrNew(
        store,
        ctx,
        binding.schema,
        ctx.get(PUSHED_RESOURCE_KEY) as MessageShape<Res>,
        `failed to save ${binding.noun}`,
      );
    },
  };
}

/**
 * <Kind>PushAuthorizationTuples — the tuple-lifecycle splice for the push
 * lane, the skill push's shape: a genuine create fires the creation event;
 * a re-push diffs the stored level against the pushed head.
 */
export function newPushAuthorizationTuplesStep<
  Res extends DescMessage,
  Req extends DescMessage,
>(
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
  stepName: string,
): PipelineStep<Req> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<Req>): Promise<void> {
      if (lifecycle === undefined) {
        return;
      }
      const head = ctx.get(PUSHED_RESOURCE_KEY) as MessageShape<Res>;
      if (ctx.get(SHOULD_CREATE_KEY) === true) {
        const event = resolveResourceCreatedEvent(
          ctx.apiResourceKind,
          head,
          ctx.callerIdentity,
          logger,
        );
        if (event === undefined) {
          return;
        }
        try {
          await lifecycle.onResourceCreated(event);
        } catch (error) {
          throw internalError(error, "failed to create authorization tuples");
        }
        return;
      }
      const existing = ctx.get(EXISTING_PUSHED_RESOURCE_KEY) as MessageShape<Res> | undefined;
      const oldLevel =
        (existing === undefined ? undefined : metadataOf(existing)?.visibility) ??
        ApiResourceVisibility.api_resource_visibility_unspecified;
      const newLevel =
        metadataOf(head)?.visibility ??
        ApiResourceVisibility.api_resource_visibility_unspecified;
      const { shapesToCreate, shapesToDelete } = diffVisibilityShapes(
        ctx.apiResourceKind,
        oldLevel,
        newLevel,
      );
      if (shapesToCreate.length === 0 && shapesToDelete.length === 0) {
        return;
      }
      try {
        await lifecycle.onVisibilityChanged({
          kind: ctx.apiResourceKind,
          resourceId: metadataOf(head)?.id ?? "",
          orgId: metadataOf(head)?.org ?? "",
          caller: ctx.callerIdentity,
          shapesToCreate,
          shapesToDelete,
        });
      } catch (error) {
        throw internalError(error, "failed to update visibility tuples");
      }
    },
  };
}
