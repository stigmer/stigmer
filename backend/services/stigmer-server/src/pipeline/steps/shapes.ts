/**
 * Resource shape access (metadata, ID-wrapper values, the status
 * reflection helpers).
 *
 * protobuf-es messages are plain objects sharing the SAME generated
 * ApiResourceMetadata type, so metadata is read structurally — the
 * idiomatic access, not a shortcut. Reflection remains
 * only where a message must be CREATED generically (a kind-specific status
 * message needs its schema, which only the resource's descriptor knows).
 */
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import type { DescField, DescMessage, Message } from "@bufbuild/protobuf";

import type { ApiResourceMetadata } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

/** Every API resource carries metadata of this one type. */
export interface HasMetadataShape {
  metadata?: ApiResourceMetadata;
}

/** ID-wrapper inputs (AgentId, OrganizationId, …). */
export interface HasValueShape {
  value: string;
}

/**
 * The resource's metadata, or undefined when the message has none set.
 */
export function metadataOf(msg: Message): ApiResourceMetadata | undefined {
  return (msg as unknown as HasMetadataShape).metadata;
}

/**
 * The organization a row's references are judged in: its `metadata.org`,
 * or, for an Organization, whose own `metadata.org` is always empty, its
 * own id. The steps that resolve and judge references and record vault
 * attachments read it here, so the vaults an organization's own settings
 * name (its embedding vaults) are judged as its resources' vaults are.
 */
export function owningOrgOf(schema: DescMessage, msg: Message): string {
  const metadata = metadataOf(msg);
  if (schema.typeName === OrganizationSchema.typeName) {
    return metadata?.id ?? "";
  }
  return metadata?.org ?? "";
}

/**
 * The parent organization of the organization a row's references are judged
 * in, when the row itself says it: an Organization judging its own settings
 * is that organization, and the row being written is its newest word (on a
 * create its stored row does not exist yet; `spec.parent_org` is written at
 * create only). The request names that parent, so a chain may judge
 * references against it only after the caller is authorized on it
 * (organization create runs the reference steps after
 * ValidateChildOrganization). Undefined for every other kind, whose
 * writer's parent is read from the store.
 */
export function ownParentOrgOf(schema: DescMessage, msg: Message): string | undefined {
  if (schema.typeName !== OrganizationSchema.typeName) {
    return undefined;
  }
  return (msg as Organization).spec?.parentOrg ?? "";
}

/** The ID-wrapper's value ("" when absent). */
export function idValueOf(msg: Message): string {
  const value = (msg as unknown as Partial<HasValueShape>).value;
  return typeof value === "string" ? value : "";
}

/** proto snake_case field name → the generated property name. */
function camelCaseFieldName(specField: string): string {
  return specField.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * The parent id a `kind_meta` ParentRelationConfig names, read from the
 * resource's spec (`spec_field`) or, for a link only the server may write,
 * from its status (`status_field`, a session's routine) — the
 * ParentIdExtractorRegistry port, with zero hardcoded kind knowledge: the
 * proto config names the field, this reads it structurally (messages are
 * plain objects whose properties are the camelCase proto field names, and
 * a oneof member is held under its oneof's property as `{ case, value }`,
 * as a run's session_id is under `target`). Returns "" for every miss (no
 * message, no field, non-string value); the caller decides whether that is
 * fatal — the tuple lifecycle throws at create, the list scope carries no
 * parent.
 *
 * ONE reader for both: the id the authorization tuple was written with is
 * the id the list scope later asks the authorization backend about, so
 * the two cannot drift. Takes `object` rather than
 * `Message` because the list lanes hand the scope structurally-typed rows
 * and their unit suite hands it plain objects — the same posture
 * `metadataOf` takes behind its cast.
 */
export function parentIdOf(
  resource: object,
  parent: { readonly specField: string; readonly statusField: string },
): string {
  const [holder, field] =
    parent.statusField !== ""
      ? [(resource as { status?: Record<string, unknown> }).status, parent.statusField]
      : [(resource as { spec?: Record<string, unknown> }).spec, parent.specField];
  if (holder === undefined) {
    return "";
  }
  const name = camelCaseFieldName(field);
  const value = holder[name];
  if (typeof value === "string") {
    return value;
  }
  for (const held of Object.values(holder)) {
    if (
      held !== null &&
      typeof held === "object" &&
      (held as { case?: unknown }).case === name
    ) {
      const member = (held as { value?: unknown }).value;
      return typeof member === "string" ? member : "";
    }
  }
  return "";
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
 * undefined when the message has no status FIELD or the field is unset.
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
 * The resource's status, created and attached when absent. Returns
 * undefined only when the message has no status field at all (a no-op for
 * such kinds).
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

/** Whether the message's schema declares a status field. */
export function hasStatusField(schema: DescMessage): boolean {
  return schema.fields.some(
    (f) => f.name === "status" && f.fieldKind === "message",
  );
}
