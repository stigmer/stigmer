// The slug rules every manifest engine follows: the SDK's ManifestClient
// (the console's YAML editors) and the CLI's `apply -f`, which share the
// manifest registry and now these three functions.
//
// A resource's slug changes only through `rename` (an apply or update keeps
// the stored slug), so a manifest that carries the resource's id and a new
// slug is followed with one rename after the apply: `followDeclaredSlug`.
// Without the id the slug is how apply finds the resource, so a new slug is
// a new resource and nothing follows. A kind with no rename keeps its slug,
// and the outcome says so instead of dropping the change in silence; a
// refusal after the spec landed would report an error over a save that
// happened.
//
// A write that names a slug the resource was renamed away from is refused
// SLUG_RENAMED, and the refusal never names the current slug (the server
// answers before it authorizes the target). `applyNamingCurrentSlug` reads
// the resource by the old slug, as the caller, and names the slug it has
// now.
//
// `resolveManifestTarget` answers what an apply will do before it runs, by
// the lookup the server's apply makes: the manifest's id first, then its
// slug. A preview built on it cannot disagree with the apply, but for one
// case: the server also requires the id's resource to be in the manifest's
// organization, which a client cannot compare when the manifest names its
// organization by slug. A file carrying another organization's id previews
// as that resource.
//
// Each rule's refusal is a typed StigmerError chained to the server's error,
// so a caller words it for its surface and `getErrorReason` still reads the
// server's reason. Pinned by __tests__/manifest-slug.test.ts.

import { create, type Message } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  ApiResourceReferenceSchema,
  RenameInputSchema,
  type ApiResourceReference,
  type RenameInput,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { getErrorReason, StigmerError, wrapError } from "../errors.js";
import { metadataOf } from "./parse.js";
import type { ServiceClientFn } from "./registry.js";

/**
 * What the slug rules need of a kind: its apply, and its rename and read by
 * reference where it has them. Every manifest registry handler satisfies
 * it, and so does each kind the CLI applies beside them.
 */
export interface SlugRulesHandler {
  readonly kind: ApiResourceKind;
  /** Human-facing name for messages, e.g. `"Agent Share"`. */
  readonly displayName: string;
  apply(clientFor: ServiceClientFn, message: Message): Promise<Message>;
  rename?(clientFor: ServiceClientFn, input: RenameInput): Promise<Message>;
  getByReference?(clientFor: ServiceClientFn, ref: ApiResourceReference): Promise<Message>;
}

/**
 * The server's reason for a write that names a resource by a slug it was
 * renamed away from.
 */
const REASON_SLUG_RENAMED = "SLUG_RENAMED";

/**
 * A write named a slug the resource was renamed away from. The old slug
 * still leads to the resource for reading for 30 days; a write must use the
 * current slug or the id.
 */
export class SlugRenamedError extends StigmerError {
  /** The slug the manifest named. */
  readonly slug: string;
  /** The slug the resource has now. */
  readonly currentSlug: string;

  /**
   * @param cause - The server's refusal, when an apply was refused; absent
   *   when a preview found the rename before any write.
   */
  constructor(displayName: string, slug: string, currentSlug: string, cause?: unknown) {
    super(
      "failed-precondition",
      `${displayName} '${slug}' was renamed to '${currentSlug}'; ` +
        `set metadata.slug to '${currentSlug}' and apply again`,
      Code.FailedPrecondition,
      cause === undefined ? undefined : { cause },
    );
    this.name = "SlugRenamedError";
    this.slug = slug;
    this.currentSlug = currentSlug;
  }
}

/**
 * The spec landed, and the rename that followed it was refused. The
 * resource keeps `slug`; `applied` is what the apply stored.
 */
export class SlugChangeRefusedError extends StigmerError {
  /** The resource as the apply stored it, under its kept slug. */
  readonly applied: Message;
  /** The slug the manifest declared. */
  readonly declaredSlug: string;
  /** The slug the resource keeps. */
  readonly slug: string;

  constructor(
    displayName: string,
    applied: Message,
    declaredSlug: string,
    slug: string,
    cause: unknown,
  ) {
    const wrapped = wrapError(cause);
    super(
      wrapped.code,
      `${displayName} spec applied, but the rename to '${declaredSlug}' was refused: ` +
        `${wrapped.message}. The slug stays '${slug}'`,
      wrapped.connectCode,
      { cause },
    );
    this.name = "SlugChangeRefusedError";
    this.applied = applied;
    this.declaredSlug = declaredSlug;
    this.slug = slug;
  }
}

/**
 * Apply a resource. A refusal for a renamed-away slug is answered with the
 * slug the resource has now, read as the caller by the old slug; a caller
 * who may not read it, or a kind with no read by reference, gets the
 * server's own error unchanged, as does every other refusal.
 *
 * @throws {SlugRenamedError} When the manifest names a previous slug and
 *   the caller can read the resource.
 */
export async function applyNamingCurrentSlug(
  clientFor: ServiceClientFn,
  handler: SlugRulesHandler,
  message: Message,
): Promise<Message> {
  try {
    return await handler.apply(clientFor, message);
  } catch (err) {
    const reason = getErrorReason(err);
    if (reason?.reason !== REASON_SLUG_RENAMED || handler.getByReference === undefined) {
      throw err;
    }
    const metadata = metadataOf(message);
    const slug = reason.metadata.slug ?? metadata?.slug ?? "";
    let current = "";
    try {
      const found = await handler.getByReference(
        clientFor,
        create(ApiResourceReferenceSchema, { kind: handler.kind, org: metadata?.org ?? "", slug }),
      );
      current = metadataOf(found)?.slug ?? "";
    } catch {
      throw err;
    }
    if (current === "" || current === slug) {
      throw err;
    }
    throw new SlugRenamedError(handler.displayName, slug, current, err);
  }
}

/** What following a manifest's declared slug did. */
export interface DeclaredSlugOutcome {
  /** The resource as it stands: the renamed one, or the applied one. */
  readonly message: Message;
  /** The slug the resource had before a rename; absent when none ran. */
  readonly renamedFrom?: string;
  /**
   * `true` when the manifest carries the id and a different slug, and the
   * kind has no rename: the resource keeps its slug.
   */
  readonly slugKept: boolean;
}

/**
 * Follow an applied manifest's declared slug with a rename, when the
 * manifest carries the resource's id and a slug other than the stored one.
 *
 * @param declared - The message the manifest declared (what was applied).
 * @param applied - What the apply returned.
 * @throws {SlugChangeRefusedError} When the rename is refused; the spec
 *   has landed.
 */
export async function followDeclaredSlug(
  clientFor: ServiceClientFn,
  handler: SlugRulesHandler,
  declared: Message,
  applied: Message,
): Promise<DeclaredSlugOutcome> {
  const declaredMeta = metadataOf(declared);
  const appliedMeta = metadataOf(applied);
  if (
    declaredMeta === undefined ||
    appliedMeta === undefined ||
    declaredMeta.id === "" ||
    declaredMeta.slug === "" ||
    declaredMeta.slug === appliedMeta.slug
  ) {
    return { message: applied, slugKept: false };
  }
  if (handler.rename === undefined) {
    return { message: applied, slugKept: true };
  }
  try {
    const renamed = await handler.rename(
      clientFor,
      create(RenameInputSchema, { resourceId: appliedMeta.id, slug: declaredMeta.slug }),
    );
    return { message: renamed, renamedFrom: appliedMeta.slug, slugKept: false };
  } catch (err) {
    throw new SlugChangeRefusedError(
      handler.displayName,
      applied,
      declaredMeta.slug,
      appliedMeta.slug,
      err,
    );
  }
}

/**
 * What applying a manifest will do, resolved against live server state:
 * - `create`: no resource answers to the manifest's id or slug;
 * - `update`: the resource exists under `slug`; `slugKept` when the manifest
 *   declares another slug its kind cannot rename to;
 * - `rename`: the resource exists under `from`, and the apply renames it to
 *   `slug`.
 */
export type ManifestTarget =
  | { readonly action: "create"; readonly slug: string }
  | {
      readonly action: "update";
      readonly slug: string;
      readonly current: Message;
      readonly slugKept: boolean;
    }
  | {
      readonly action: "rename";
      readonly from: string;
      readonly slug: string;
      readonly current: Message;
    };

/** The document fields {@link resolveManifestTarget} reads. */
export interface TargetDocument {
  readonly handler: SlugRulesHandler & {
    getByReference(clientFor: ServiceClientFn, ref: ApiResourceReference): Promise<Message>;
  };
  readonly message: Message;
  /** The slug the apply will use: `metadata.slug`, or the name without one. */
  readonly slug: string;
  readonly org: string;
}

/**
 * Resolve what applying a document will do, by the lookup the server's
 * apply makes: the manifest's id first, then its slug (the module header
 * names the one case a client cannot tell apart).
 *
 * @throws {SlugRenamedError} When the manifest has no id and names a slug
 *   the resource was renamed away from: the apply would be refused.
 * @throws {StigmerError} For a failed read other than not-found.
 */
export async function resolveManifestTarget(
  clientFor: ServiceClientFn,
  document: TargetDocument,
): Promise<ManifestTarget> {
  const { handler, org } = document;
  const declared = metadataOf(document.message);
  const id = declared?.id ?? "";
  const declaredSlug = declared?.slug ?? "";

  if (id !== "") {
    const byId = await readOrNull(clientFor, handler, { kind: handler.kind, id });
    const stored = byId === null ? undefined : metadataOf(byId);
    if (byId !== null && stored !== undefined) {
      if (declaredSlug === "" || declaredSlug === stored.slug) {
        return { action: "update", slug: stored.slug, current: byId, slugKept: false };
      }
      if (handler.rename === undefined) {
        return { action: "update", slug: stored.slug, current: byId, slugKept: true };
      }
      return { action: "rename", from: stored.slug, slug: declaredSlug, current: byId };
    }
  }

  const bySlug = await readOrNull(clientFor, handler, { kind: handler.kind, org, slug: document.slug });
  if (bySlug === null) {
    return { action: "create", slug: document.slug };
  }
  const current = metadataOf(bySlug)?.slug ?? document.slug;
  if (current !== document.slug) {
    throw new SlugRenamedError(handler.displayName, document.slug, current);
  }
  return { action: "update", slug: current, current: bySlug, slugKept: false };
}

async function readOrNull(
  clientFor: ServiceClientFn,
  handler: TargetDocument["handler"],
  ref: { kind: ApiResourceKind; id?: string; org?: string; slug?: string },
): Promise<Message | null> {
  try {
    return await handler.getByReference(clientFor, create(ApiResourceReferenceSchema, ref));
  } catch (e) {
    const wrapped = wrapError(e);
    if (wrapped.code === "not-found") return null;
    throw wrapped;
  }
}
