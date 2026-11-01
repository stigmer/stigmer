// Kind-agnostic apply/lookup over the manifest registry.
//
// One client, every registry kind: `apply` drives the kind's command
// controller with the full resource proto and follows the manifest's
// visibility and slug rules (visibility.ts, slug.ts), the same ones
// `stigmer apply -f` follows. The server finds the resource by the
// manifest's id, then by its slug; a declared level other than the stored
// one is landed through `updateVisibility`, then a manifest that carries
// the id and a new slug is renamed. Visibility goes first so a refused
// rename reports a level that landed. `resolveTarget` answers what an
// apply will do by that same lookup, for previews; `getByReference` loads
// current server state for YAML editing.

import type { Message } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import type { DescService } from "@bufbuild/protobuf";
import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { wrapError } from "../gen/errors.js";
import { metadataOf, type ManifestDocument } from "./parse.js";
import {
  applyNamingCurrentSlug,
  followDeclaredSlug,
  resolveManifestTarget,
  type ManifestTarget,
} from "./slug.js";
import { followDeclaredVisibility } from "./visibility.js";
import {
  manifestHandlerForYamlKind,
  manifestKinds,
  type ManifestKindHandler,
  type ServiceClientFn,
} from "./registry.js";

/** Result of applying one manifest document. */
export interface AppliedManifest {
  /** The YAML kind that was applied, e.g. `"Agent"`. */
  readonly yamlKind: string;
  /** Human-facing kind name, e.g. `"MCP Server"`. */
  readonly displayName: string;
  /** Server-authoritative resource name. */
  readonly name: string;
  /** Server-authoritative slug (routing key for future applies). */
  readonly slug: string;
  /** Organization the resource lives in. */
  readonly org: string;
  /** Server-assigned resource id. */
  readonly id: string;
  /** The full applied resource, as returned by the server. */
  readonly message: Message;
  /** The slug the resource had before the apply renamed it; absent when it did not. */
  readonly renamedFrom?: string;
  /**
   * `true` when the manifest carried the resource's id and another slug,
   * and the kind has no rename: the spec landed and the resource keeps
   * `slug`.
   */
  readonly slugKept: boolean;
  /**
   * `true` when the manifest declared another visibility and the kind has
   * no `updateVisibility`: the spec landed and the resource keeps its
   * level.
   */
  readonly visibilityKept: boolean;
}

/**
 * Client for applying and loading Stigmer resources as manifests,
 * independent of kind.
 *
 * Complements the typed per-kind clients (`stigmer.agent`, …): those take
 * curated `*Input` shapes for programmatic use; this one takes full
 * resource protos produced by {@link parseManifest} — the declarative
 * "apply this YAML" path, with the same semantics as `stigmer apply -f`.
 *
 * @example
 * ```ts
 * const docs = parseManifest(yamlText, { org: "acme" });
 * for (const doc of docs) {
 *   const applied = await stigmer.manifest.apply(doc);
 *   console.log(`${applied.displayName} ${applied.slug} applied`);
 * }
 * ```
 */
export class ManifestClient {
  // Raw controller clients are created lazily and cached per service —
  // one dialog session typically touches one or two kinds.
  private readonly clients = new Map<DescService, Client<DescService>>();
  private readonly transport: Transport;
  private readonly clientFor: ServiceClientFn;

  constructor(transport: Transport) {
    this.transport = transport;
    this.clientFor = <Desc extends DescService>(service: Desc): Client<Desc> => {
      let client = this.clients.get(service);
      if (client === undefined) {
        client = createClient(service, this.transport);
        this.clients.set(service, client);
      }
      return client as Client<Desc>;
    };
  }

  /** The kinds this client can apply, in dependency apply order. */
  supportedKinds(): readonly ManifestKindHandler[] {
    return manifestKinds();
  }

  /**
   * Apply one parsed manifest document. The server finds the resource by
   * the manifest's `metadata.id`, then by its slug, and creates it when
   * neither answers. A declared visibility other than the stored one then
   * lands through the kind's `updateVisibility`, and a manifest that
   * carries the id and a different slug is renamed through its `rename`;
   * a kind without the door keeps its level or slug and the result says so
   * (`visibilityKept`, `slugKept`).
   *
   * @throws {SlugRenamedError} When the manifest names a slug the resource
   *   was renamed away from; the error names the current one.
   * @throws {VisibilityChangeRefusedError} When the spec landed and the
   *   visibility change was refused; the error carries the applied
   *   resource.
   * @throws {SlugChangeRefusedError} When the spec landed and the rename
   *   was refused; the error carries the applied resource, at any level
   *   that landed before it.
   * @throws {StigmerError} When the server rejects the apply
   *   (validation, permissions, …).
   */
  async apply(document: ManifestDocument): Promise<AppliedManifest> {
    let applied: Message;
    let renamedFrom: string | undefined;
    let slugKept: boolean;
    let visibilityKept: boolean;
    try {
      const stored = await applyNamingCurrentSlug(this.clientFor, document.handler, document.message);
      const visibility = await followDeclaredVisibility(
        this.clientFor,
        document.handler,
        document.message,
        stored,
      );
      const followed = await followDeclaredSlug(
        this.clientFor,
        document.handler,
        document.message,
        visibility.message,
      );
      applied = followed.message;
      renamedFrom = followed.renamedFrom;
      slugKept = followed.slugKept;
      visibilityKept = visibility.visibilityKept;
    } catch (e) {
      throw wrapError(e);
    }

    const metadata = metadataOf(applied);
    return {
      yamlKind: document.handler.yamlKind,
      displayName: document.handler.displayName,
      name: metadata?.name || document.name,
      slug: metadata?.slug || document.slug,
      org: metadata?.org || document.org,
      id: metadata?.id ?? "",
      message: applied,
      ...(renamedFrom !== undefined && { renamedFrom }),
      slugKept,
      visibilityKept,
    };
  }

  /**
   * What applying a document will do, resolved against live server state
   * by the lookup the apply makes: `create`, `update` (with `slugKept` when
   * the kind cannot take a declared slug), or `rename` from the stored slug,
   * each but `create` with `visibilityKept` when the kind cannot take a
   * declared level.
   *
   * @throws {SlugRenamedError} When the document has no id and names a
   *   slug the resource was renamed away from: the apply would be refused.
   * @throws {StigmerError} For a failed read other than not-found.
   */
  async resolveTarget(document: ManifestDocument): Promise<ManifestTarget> {
    return resolveManifestTarget(this.clientFor, document);
  }

  /**
   * Load a resource's current server state by kind + org/slug reference.
   *
   * @returns The resource proto, or `null` when it does not exist —
   *   the create-vs-update discriminator for previews.
   * @throws {Error} When the kind is not in the manifest registry.
   * @throws {StigmerError} For failures other than not-found.
   */
  async getByReference(
    yamlKind: string,
    org: string,
    slug: string,
  ): Promise<Message | null> {
    const handler = manifestHandlerForYamlKind(yamlKind);
    if (handler === undefined) {
      const supported = manifestKinds()
        .map((h) => h.yamlKind)
        .join(", ");
      throw new Error(
        `Unsupported resource kind "${yamlKind}". Supported kinds: ${supported}.`,
      );
    }

    const ref = create(ApiResourceReferenceSchema, {
      org,
      slug,
      kind: handler.kind,
    });

    try {
      return await handler.getByReference(this.clientFor, ref);
    } catch (e) {
      const wrapped = wrapError(e);
      if (wrapped.code === "not-found") return null;
      throw wrapped;
    }
  }
}
