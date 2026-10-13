/**
 * A resource's etag (AIP-154): a fingerprint of what a person edits, its
 * spec, name, labels, tags and annotations, as stored. Every driver stamps
 * it onto the message it is handed on every write, as it derives the list
 * index facts from that message, so a chain's response carries the etag
 * with no read. A status write leaves those fields as they were, so it
 * leaves the etag as it was, and an editor's save never conflicts with the
 * platform's own bookkeeping. A raw maintenance swap of stored bytes
 * (replaceResourceDataIfUnchanged) stamps nothing: what a person sees did
 * not change.
 *
 * Reads answer the etag as stored; redaction and the reference fill change
 * only the response, never the stored fingerprint.
 *
 * Pinned by __tests__/etag.test.ts and the store contract.
 */
import { createHash } from "node:crypto";

import { toJson } from "@bufbuild/protobuf";
import type { DescMessage, JsonValue, MessageShape } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { canonicalJson } from "./canonical.js";

/** The etag `resource` should carry, or undefined for a message with no resource metadata. */
export function etagOf<Desc extends DescMessage>(
  schema: Desc,
  resource: MessageShape<Desc>,
): string | undefined {
  const root = reflect(schema, resource);
  const metadata = metadataOf(root);
  if (metadata === undefined) {
    return undefined;
  }
  const specField = root.desc.fields.find((field) => field.name === "spec");
  let spec: JsonValue = null;
  if (specField?.fieldKind === "message" && root.isSet(specField)) {
    const value = root.get(specField) as ReflectMessage;
    spec = toJson(specField.message, value.message, {
      enumAsInteger: true,
      useProtoFieldName: true,
    });
  }
  const edited: JsonValue = {
    spec,
    name: metadata.name,
    labels: { ...metadata.labels },
    tags: [...metadata.tags],
    annotations: { ...metadata.annotations },
  };
  return createHash("sha256").update(canonicalJson(edited)).digest("hex");
}

/** Stamps `resource`'s etag onto its metadata; a message with no resource metadata is left as it is. */
export function stampEtag<Desc extends DescMessage>(
  schema: Desc,
  resource: MessageShape<Desc>,
): void {
  const etag = etagOf(schema, resource);
  if (etag === undefined) {
    return;
  }
  const metadata = metadataOf(reflect(schema, resource));
  if (metadata !== undefined) {
    metadata.etag = etag;
  }
}

function metadataOf(root: ReflectMessage): ApiResourceMetadata | undefined {
  const field = root.desc.fields.find((candidate) => candidate.name === "metadata");
  if (
    field?.fieldKind !== "message" ||
    field.message.typeName !== ApiResourceMetadataSchema.typeName ||
    !root.isSet(field)
  ) {
    return undefined;
  }
  return (root.get(field) as ReflectMessage).message as ApiResourceMetadata;
}
