/**
 * Resource shape access — ports steps/interfaces.go (HasMetadata,
 * HasValue, the status reflection helpers).
 *
 * Where Go needed protoreflect to reach metadata/status generically (its
 * generated types are concrete structs), protobuf-es messages are plain
 * objects sharing the SAME generated ApiResourceMetadata type — structural
 * access is the idiomatic equivalent, not a shortcut. Reflection remains
 * only where a message must be CREATED generically (a kind-specific status
 * message needs its schema, which only the resource's descriptor knows).
 */
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import type { DescField, DescMessage, Message } from "@bufbuild/protobuf";

import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

/** Go HasMetadata: every API resource carries metadata of this one type. */
export interface HasMetadataShape {
  metadata?: ApiResourceMetadata;
}

/** Go HasValue / HasIdValue: ID-wrapper inputs (AgentId, OrganizationId, …). */
export interface HasValueShape {
  value: string;
}

/**
 * The resource's metadata, or undefined when the message has none set.
 * (Go's HasMetadata type assertion + GetMetadata nil-check collapsed.)
 */
export function metadataOf(msg: Message): ApiResourceMetadata | undefined {
  return (msg as unknown as HasMetadataShape).metadata;
}

/** The ID-wrapper's value ("" when absent) — Go HasValue.GetValue(). */
export function idValueOf(msg: Message): string {
  const value = (msg as unknown as Partial<HasValueShape>).value;
  return typeof value === "string" ? value : "";
}

/** A message-typed field, statically narrowed so get()/set() type-check. */
export type MessageDescField = Extract<DescField, { fieldKind: "message" }>;

/**
 * Finds a singular message field by proto name with the narrowing TS needs
 * to give ReflectMessage out of get() — the reflection idiom every helper
 * in this library shares.
 */
export function messageFieldByName(
  msg: ReflectMessage,
  name: string,
): MessageDescField | undefined {
  const field = msg.fields.find((f) => f.name === name);
  return field !== undefined && field.fieldKind === "message"
    ? field
    : undefined;
}

/**
 * The resource's status as a write-through reflection wrapper, or
 * undefined when the message has no status FIELD or the field is unset —
 * Go getStatusField.
 */
export function getStatusField(
  schema: DescMessage,
  msg: Message,
): ReflectMessage | undefined {
  const root = reflect(schema, msg);
  const field = messageFieldByName(root, "status");
  if (field === undefined || !root.isSet(field)) {
    return undefined;
  }
  return root.get(field);
}

/**
 * The resource's status, created and attached when absent — Go
 * getOrCreateStatusField. Returns undefined only when the message has no
 * status field at all (a no-op for such kinds, as in Go).
 */
export function getOrCreateStatusField(
  schema: DescMessage,
  msg: Message,
): ReflectMessage | undefined {
  const root = reflect(schema, msg);
  const field = messageFieldByName(root, "status");
  if (field === undefined) {
    return undefined;
  }
  if (!root.isSet(field)) {
    root.set(field, reflect(field.message));
  }
  return root.get(field);
}

/** Whether the message's schema declares a status field — Go hasStatusField. */
export function hasStatusField(schema: DescMessage): boolean {
  return schema.fields.some(
    (f) => f.name === "status" && f.fieldKind === "message",
  );
}
