// Kind-agnostic apply/lookup over the manifest registry.
//
// One client, every registry kind: `apply` drives the kind's command
// controller with the full resource proto (create-or-update by slug,
// server-side), `getByReference` loads current server state for
// create-vs-update previews and YAML editing.

import type { Message } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import type { DescService } from "@bufbuild/protobuf";
import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { wrapError } from "../gen/errors.js";
import { metadataOf, type ManifestDocument } from "./parse.js";
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
   * Apply one parsed manifest document (create-or-update by slug).
   *
   * @throws {StigmerError} When the server rejects the apply
   *   (validation, permissions, …).
   */
  async apply(document: ManifestDocument): Promise<AppliedManifest> {
    let applied: Message;
    try {
      applied = await document.handler.apply(this.clientFor, document.message);
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
    };
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
