// Strict YAML → proto parsing for Stigmer resource manifests.
//
// The strictness contract matches `stigmer apply -f`: YAML syntax errors and
// unknown fields both fail loudly (`ignoreUnknownFields: false`) — silently
// applying a half-parsed or typo'd document would be dangerous. Error
// messages are written for end users (DD-006): what failed, where, and what
// a valid document looks like.

import { fromJson, type JsonValue, type Message } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import {
  type ApiResourceMetadata,
  ApiResourceMetadataSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { parseAllDocuments } from "yaml";
import {
  type ManifestKindHandler,
  manifestHandlerForYamlKind,
  manifestKinds,
} from "./registry.js";

/** Options for {@link parseManifest}. */
export interface ParseManifestOptions {
  /**
   * Target organization slug. Injected into `metadata.org` when the document
   * omits it. When the document specifies a *different* org, the document's
   * value wins and a warning is attached (matching `stigmer apply`).
   */
  readonly org?: string;
}

/** One resource document parsed from a manifest. */
export interface ManifestDocument {
  /** The registry handler for this document's kind. */
  readonly handler: ManifestKindHandler;
  /** The fully-marshalled resource proto, ready for `apply`. */
  readonly message: Message;
  /** `metadata.name` (always present — validated). */
  readonly name: string;
  /** `metadata.slug`, or the name when the document has no explicit slug. */
  readonly slug: string;
  /** `metadata.org` after org injection ("" when unresolvable). */
  readonly org: string;
  /** Org-mismatch warning, when the document's org differs from the target. */
  readonly warning?: string;
}

/**
 * Parse a (possibly multi-document) YAML manifest into resource protos.
 *
 * Each document is validated against its kind's generated proto schema —
 * the same schemas the backend serves — so a document that parses here is
 * structurally valid for `apply`. Documents are returned in **dependency
 * apply order** (referenced kinds before dependents, stable within a kind),
 * mirroring the CLI's apply ordering.
 *
 * @param content - Raw YAML text (one or more `---`-separated documents).
 * @param options - Optional target org for `metadata.org` injection.
 * @returns The parsed documents, sorted into dependency apply order.
 * @throws {Error} With a user-facing message when the YAML is malformed,
 *   a document has no `kind`, the kind is unsupported, or a document does
 *   not match its proto schema (unknown fields included).
 *
 * @example
 * ```ts
 * import { parseManifest } from "@stigmer/sdk";
 *
 * const docs = parseManifest(yamlText, { org: "acme" });
 * for (const doc of docs) {
 *   await stigmer.manifest.apply(doc);
 * }
 * ```
 */
export function parseManifest(
  content: string,
  options: ParseManifestOptions = {},
): ManifestDocument[] {
  if (!content.trim()) {
    throw new Error(
      "The manifest is empty. Paste or upload a Stigmer resource YAML " +
        "(a document with apiVersion, kind, metadata, and spec).",
    );
  }

  const parsed = parseAllDocuments(content);
  const documents: ManifestDocument[] = [];

  for (const [index, doc] of parsed.entries()) {
    const where = parsed.length === 1 ? "the manifest" : `document ${index + 1}`;

    if (doc.errors.length > 0) {
      throw new Error(`Invalid YAML in ${where}: ${doc.errors[0].message}`);
    }

    const value = doc.toJS() as unknown;
    if (value === null || value === undefined) continue; // blank document between separators
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Invalid YAML in ${where}: expected a mapping document with ` +
          "apiVersion, kind, metadata, and spec.",
      );
    }

    documents.push(parseDocument(value as Record<string, unknown>, where, options.org));
  }

  if (documents.length === 0) {
    throw new Error(
      "The manifest contains no resource documents. Each document needs " +
        "at least a kind (e.g. kind: Agent) and metadata.name.",
    );
  }

  // Stable sort into dependency order so multi-document manifests apply
  // parents before dependents (e.g. Environment before AgentChannel).
  return documents.sort((a, b) => a.handler.applyOrder - b.handler.applyOrder);
}

function parseDocument(
  value: Record<string, unknown>,
  where: string,
  org: string | undefined,
): ManifestDocument {
  const kind = value.kind;
  if (typeof kind !== "string" || kind === "") {
    throw new Error(
      `${capitalize(where)} is missing the required 'kind' field ` +
        "(e.g. kind: Agent).",
    );
  }

  const handler = manifestHandlerForYamlKind(kind);
  if (handler === undefined) {
    const supported = manifestKinds()
      .map((h) => h.yamlKind)
      .join(", ");
    throw new Error(
      `Unsupported resource kind "${kind}" in ${where}. ` +
        `Supported kinds: ${supported}.`,
    );
  }

  let message: Message;
  try {
    message = fromJson(handler.schema, value as JsonValue, {
      ignoreUnknownFields: false,
    });
  } catch (err) {
    throw new Error(
      `Invalid ${handler.displayName} in ${where}: ${(err as Error).message}`,
    );
  }

  const warning = injectOrg(message, org ?? "");

  const metadata = metadataOf(message);
  const name = metadata?.name ?? "";
  if (name === "") {
    throw new Error(
      `${capitalize(where)} is missing the required metadata.name field.`,
    );
  }

  return {
    handler,
    message,
    name,
    slug: metadata?.slug || name,
    org: metadata?.org ?? "",
    ...(warning !== undefined && { warning }),
  };
}

/** Read a resource message's metadata envelope, if present. */
export function metadataOf(message: Message): ApiResourceMetadata | undefined {
  return (message as unknown as { metadata?: ApiResourceMetadata }).metadata;
}

// Inject the target org into metadata.org when the document omitted it. When
// the document specifies a *different* org, the document's value is honored
// and a warning is returned (matching `stigmer apply`).
function injectOrg(message: Message, org: string): string | undefined {
  if (org === "") return undefined;
  const holder = message as unknown as { metadata?: ApiResourceMetadata };
  if (holder.metadata === undefined) {
    holder.metadata = create(ApiResourceMetadataSchema, { org });
    return undefined;
  }
  if (holder.metadata.org === "") {
    holder.metadata.org = org;
    return undefined;
  }
  if (holder.metadata.org !== org) {
    return (
      `The document's org "${holder.metadata.org}" differs from the ` +
      `target org "${org}"; applying to "${holder.metadata.org}".`
    );
  }
  return undefined;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
