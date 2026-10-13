// Proto → canonical Stigmer YAML serialization.
//
// Follows the platform-wide protojson parity contract (Go CLI, TS CLI
// output/proto.ts, mcp-server marshal.ts): `toJson` with
// `useProtoFieldName: true` emits snake_case field names and omits unset
// defaults, so the output round-trips through `parseManifest`'s strict
// `fromJson` without loss.
//
// Four deliberate departures from the raw protojson projection, all for
// the *editable manifest* use case:
//   - `status` and `metadata.version` are stripped — they are system-managed
//     and would be ignored (or rejected) on apply.
//   - `metadata.etag` is stripped: an apply that carries one is refused once
//     the resource changes, which a file kept for later must not be. An
//     editor that wants that refusal sends the etag it read itself.
//   - every reference to another resource names it by `org` and `slug`
//     alone: its `id` is dropped. The server stores the id and fills the
//     current slug in what it returns; a manifest names things, so a name
//     edited by hand is never refused as disagreeing with a leftover id. A
//     reference whose target was deleted (an id the server could name with
//     no slug) keeps its id: it has no name to write, and an apply refuses
//     it as a missing resource.
//   - the envelope field is spelled `apiVersion` (the canonical form used in
//     every repo manifest and doc); `fromJson` accepts both spellings.

import { clone, toJson, type DescMessage, type Message } from "@bufbuild/protobuf";
import { reflect, type ReflectMessage } from "@bufbuild/protobuf/reflect";
import { stringify as stringifyYaml } from "yaml";
import { manifestHandlerForTypeName, manifestKinds } from "./registry.js";

/**
 * Serialize a resource proto into the canonical, editable Stigmer YAML form.
 *
 * The resource kind is derived from the message's proto type, so any
 * registry-supported resource (an `Agent` from `stigmer.agent.get()`, a
 * `Schedule` from `stigmer.schedule.get()`, …) serializes with the
 * same call. `metadata.id` is preserved — the output is a full-fidelity
 * representation of the stored resource, minus system-managed state and
 * the ids of the resources it references, which it names by slug.
 *
 * @param message - A resource proto of a registry-supported kind.
 * @returns YAML text suitable for editing and re-applying.
 * @throws {Error} When the message's kind is not in the manifest registry.
 *
 * @example
 * ```ts
 * import { serializeManifest } from "@stigmer/sdk";
 *
 * const agent = await stigmer.agent.get(agentId);
 * const yaml = serializeManifest(agent);
 * ```
 */
export function serializeManifest(message: Message): string {
  const handler = manifestHandlerForTypeName(message.$typeName);
  if (handler === undefined) {
    const supported = manifestKinds()
      .map((h) => h.yamlKind)
      .join(", ");
    throw new Error(
      `Cannot serialize ${message.$typeName} as a manifest: kind is not ` +
        `in the manifest registry. Supported kinds: ${supported}.`,
    );
  }

  const json = toJson(handler.schema, namedReferences(handler.schema, message), {
    useProtoFieldName: true,
  });
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new Error(
      `Cannot serialize ${handler.displayName}: unexpected non-object ` +
        "protojson projection.",
    );
  }

  const { api_version, kind, status, metadata, ...rest } =
    json as Record<string, unknown>;
  void status;

  const doc: Record<string, unknown> = {
    apiVersion: typeof api_version === "string" && api_version !== ""
      ? api_version
      : handler.apiVersion,
    kind: typeof kind === "string" && kind !== "" ? kind : handler.yamlKind,
    ...(isPlainObject(metadata) && { metadata: stripSystemMetadata(metadata) }),
    ...rest,
  };

  // lineWidth: 0 disables wrapping (long instruction lines stay intact);
  // blockQuote: "literal" renders multi-line strings as readable `|` blocks.
  return stringifyYaml(doc, { lineWidth: 0, blockQuote: "literal" });
}

// metadata.version (version id, previous-version pointer, tag) is written by
// the server on every mutation; round-tripping it through an edit would be
// misleading at best. metadata.etag is the stored content's fingerprint: an
// apply carrying it is refused once anything changes (the module header).
// Everything else — including id — is user-meaningful.
function stripSystemMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const { version, etag, ...rest } = metadata;
  void version;
  void etag;
  return rest;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const API_RESOURCE_REFERENCE_TYPE =
  "ai.stigmer.commons.apiresource.ApiResourceReference";

// A copy of the message whose references name their targets by slug alone
// (the module header): each reference that carries a slug loses its id.
function namedReferences(schema: DescMessage, message: Message): Message {
  const copy = clone(schema, message);
  dropReferenceIds(reflect(schema, copy));
  return copy;
}

function dropReferenceIds(message: ReflectMessage): void {
  if (message.desc.typeName === API_RESOURCE_REFERENCE_TYPE) {
    const slug = message.desc.fields.find((f) => f.name === "slug");
    const id = message.desc.fields.find((f) => f.name === "id");
    if (slug !== undefined && id !== undefined && message.get(slug) !== "") {
      message.clear(id);
    }
    return;
  }
  for (const field of message.fields) {
    if (!message.isSet(field)) {
      continue;
    }
    if (field.fieldKind === "message") {
      dropReferenceIds(message.get(field));
    } else if (field.fieldKind === "list" && field.listKind === "message") {
      // No manifest kind holds messages in a map, so a map is not walked.
      for (const item of message.get(field)) {
        dropReferenceIds(item as ReflectMessage);
      }
    }
  }
}
