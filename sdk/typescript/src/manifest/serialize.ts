// Proto → canonical Stigmer YAML serialization.
//
// Follows the platform-wide protojson parity contract (Go CLI, TS CLI
// output/proto.ts, mcp-server marshal.ts): `toJson` with
// `useProtoFieldName: true` emits snake_case field names and omits unset
// defaults, so the output round-trips through `parseManifest`'s strict
// `fromJson` without loss.
//
// Two deliberate departures from the raw protojson projection, both for
// the *editable manifest* use case:
//   - `status` and `metadata.version` are stripped — they are system-managed
//     and would be ignored (or rejected) on apply.
//   - the envelope field is spelled `apiVersion` (the canonical form used in
//     every repo manifest and doc); `fromJson` accepts both spellings.

import { toJson, type Message } from "@bufbuild/protobuf";
import { stringify as stringifyYaml } from "yaml";
import { manifestHandlerForTypeName, manifestKinds } from "./registry.js";

/**
 * Serialize a resource proto into the canonical, editable Stigmer YAML form.
 *
 * The resource kind is derived from the message's proto type, so any
 * registry-supported resource (an `Agent` from `stigmer.agent.get()`, an
 * `Environment` from `stigmer.environment.get()`, …) serializes with the
 * same call. `metadata.id` is preserved — the output is a full-fidelity
 * representation of the stored resource, minus system-managed state.
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

  const json = toJson(handler.schema, message, { useProtoFieldName: true });
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
// misleading at best. Everything else — including id — is user-meaningful.
function stripSystemMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const { version, ...rest } = metadata;
  void version;
  return rest;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
