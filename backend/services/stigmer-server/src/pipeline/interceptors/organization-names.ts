/**
 * The organization-name resolver — a SERVING-chain interceptor, installed
 * in every edition, right after protovalidate and before the kind context
 * and the handler (pipeline/chain.ts).
 *
 * An organization is filed under its id (org_<ulid>), and every resource it
 * owns names it by that id. A person names it by its slug: in a manifest's
 * `org: acme`, a CLI's `--org acme`, a console URL. This interceptor turns
 * every organization a request names into its id before anything reads the
 * request, so authorization, every handler's comparison of a request's org
 * with a stored one, and every write see ids alone. A renamed
 * organization's previous slug resolves too, until it expires.
 *
 * Which values name an organization is read from the contract, memoised
 * per message type and per method (`organizationFieldsOf`,
 * `annotatedOrganizationPath`):
 *
 *   1. every string field named `org` or ending `_org`, and every repeated
 *      string field named `orgs`, at any depth of the input. One spelling
 *      for an organization field is the contract's own rule
 *      (docs/vocabulary.md), so the name is the signal; a reference's
 *      `org` and a resource's `metadata.org` are both covered;
 *   2. the field a method's authorization annotation names when its kind
 *      is `organization` (an Organization's own id on get, update, delete
 *      and rename);
 *   3. `ApiResourceRef.id` when the ref's kind is `organization` (a policy
 *      grant on an organization).
 *
 * A value shaped like an id passes untouched. Anything else is looked up;
 * a name nothing holds passes through unchanged, and authorization refuses
 * it exactly as it refuses an organization the caller cannot see, so the
 * resolver never tells a caller which names exist. The inventory of
 * covered fields is docs/organization-names.md, held equal to this rule by
 * organization-names-inventory.test.ts.
 *
 * Serving only, as the single-organization fill is: an in-process call is
 * server code, which passes the ids it read from storage. Content a person
 * wrote that reaches the server inside something else (a plugin package's
 * manifests) is resolved where it is read, with `resolveOrganizationNames`
 * over the same rules 1 and 3 (domain/plugin/overlay/documents.ts). A
 * request that
 * names nothing to resolve passes through untouched; one that does is
 * handed on as a resolved clone, never a mutation of the caller's message.
 */
import { ScalarType, clone, getOption, hasOption } from "@bufbuild/protobuf";
import type { DescField, DescMessage, DescMethod, Message } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import type { Interceptor } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { config as rpcAuthorizationConfig } from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

/** Turns an organization's name into its id, or undefined when nothing holds the name. */
export interface OrganizationNameResolver {
  resolve(name: string): Promise<string | undefined>;
}

/** An organization id as the server mints it: `org_` and a lowercase ULID. */
const ORGANIZATION_ID = /^org_[0-9a-z]{26}$/;

/** Whether a value is already an organization id, so needs no lookup. */
export function isOrganizationId(value: string): boolean {
  return ORGANIZATION_ID.test(value);
}

const ORGANIZATION_KIND_NAME = ApiResourceKind[ApiResourceKind.organization];

/** Whether a field names an organization by the contract's spelling rule. */
export function namesOrganization(field: DescField): boolean {
  if (field.fieldKind === "scalar" && field.scalar === ScalarType.STRING) {
    return field.name === "org" || field.name.endsWith("_org");
  }
  if (
    field.fieldKind === "list" &&
    field.listKind === "scalar" &&
    field.scalar === ScalarType.STRING
  ) {
    return field.name === "orgs";
  }
  return false;
}

/** How one message type holds organization names: its own fields, and the message fields that may hold more. */
interface MessagePlan {
  readonly orgFields: readonly DescField[];
  readonly nested: readonly DescField[];
  /** Set on ApiResourceRef: its `id` names an organization when its `kind` is "organization". */
  readonly refId?: { readonly kind: DescField; readonly id: DescField };
}

const plans = new Map<string, MessagePlan | null>();
const reaches = new Map<string, boolean>();

/** Whether a type holds an organization field itself. */
function ownsOrganizationValue(message: DescMessage): boolean {
  return (
    message.typeName === ApiResourceRefSchema.typeName ||
    message.fields.some(namesOrganization)
  );
}

/**
 * Whether any value a message type can hold, at any depth, names an
 * organization. A cycle is cut by `visiting`; a "no" found while a cycle
 * was cut may be wrong, so only a "yes" or a complete search is memoised.
 */
function reachesOrganization(
  message: DescMessage,
  visiting: Set<string> = new Set(),
): boolean {
  const known = reaches.get(message.typeName);
  if (known !== undefined) {
    return known;
  }
  if (visiting.has(message.typeName)) {
    return false;
  }
  visiting.add(message.typeName);
  const result =
    ownsOrganizationValue(message) ||
    message.fields.some((field) => {
      const child = childMessageOf(field);
      return child !== undefined && reachesOrganization(child, visiting);
    });
  visiting.delete(message.typeName);
  if (result || visiting.size === 0) {
    reaches.set(message.typeName, result);
  }
  return result;
}

/**
 * The plan for a message type, or null when no value it can hold names an
 * organization. Built once per type.
 */
function planOf(message: DescMessage): MessagePlan | null {
  const known = plans.get(message.typeName);
  if (known !== undefined) {
    return known;
  }
  if (!reachesOrganization(message)) {
    plans.set(message.typeName, null);
    return null;
  }
  const orgFields = message.fields.filter(namesOrganization);
  const nested = message.fields.filter((field) => {
    const child = childMessageOf(field);
    return child !== undefined && reachesOrganization(child);
  });
  let refId: MessagePlan["refId"];
  if (message.typeName === ApiResourceRefSchema.typeName) {
    const kind = message.fields.find((f) => f.name === "kind");
    const id = message.fields.find((f) => f.name === "id");
    if (kind !== undefined && id !== undefined) {
      refId = { kind, id };
    }
  }
  const plan =
    orgFields.length === 0 && nested.length === 0 && refId === undefined
      ? null
      : { orgFields, nested, ...(refId === undefined ? {} : { refId }) };
  plans.set(message.typeName, plan);
  return plan;
}

function childMessageOf(field: DescField): DescMessage | undefined {
  if (field.fieldKind === "message") {
    return field.message;
  }
  if (field.fieldKind === "list" && field.listKind === "message") {
    return field.message;
  }
  if (field.fieldKind === "map" && field.mapKind === "message") {
    return field.message;
  }
  return undefined;
}

/**
 * The dot path a method's authorization annotation reads when its kind is
 * statically `organization`, or undefined. Rule 2 of the module header.
 */
export function annotatedOrganizationPath(
  method: DescMethod,
): string | undefined {
  if (!hasOption(method, rpcAuthorizationConfig)) {
    return undefined;
  }
  const config = getOption(method, rpcAuthorizationConfig);
  if (
    config.resourceKind !== ApiResourceKind.organization ||
    config.resourceKindPath !== "" ||
    config.fieldPath === ""
  ) {
    return undefined;
  }
  return config.fieldPath;
}

/** Every organization field a message type can hold, as dotted paths, for the inventory. */
export function organizationFieldsOf(message: DescMessage): string[] {
  const out: string[] = [];
  const walk = (type: DescMessage, prefix: string, seen: Set<string>) => {
    const plan = planOf(type);
    if (plan === null || seen.has(type.typeName)) {
      return;
    }
    const inner = new Set(seen).add(type.typeName);
    for (const field of plan.orgFields) {
      out.push(`${prefix}${field.name}`);
    }
    if (plan.refId !== undefined) {
      out.push(`${prefix}${plan.refId.id.name} (kind organization)`);
    }
    for (const field of plan.nested) {
      const child = childMessageOf(field);
      if (child !== undefined) {
        walk(child, `${prefix}${field.name}.`, inner);
      }
    }
  };
  walk(message, "", new Set());
  return out;
}

/** Visits every organization value in a message: `visit` returns the value to put back, or undefined to leave it. */
type Visit = (value: string) => string | undefined;

function visitMessage(message: ReflectMessage, visit: Visit): void {
  const plan = planOf(message.desc);
  if (plan === null) {
    return;
  }
  for (const field of plan.orgFields) {
    if (field.fieldKind === "scalar") {
      const value = message.get(field);
      if (typeof value === "string" && value !== "") {
        const next = visit(value);
        if (next !== undefined) {
          message.set(field, next);
        }
      }
    } else if (field.fieldKind === "list") {
      const list = message.get(field);
      for (let i = 0; i < list.size; i++) {
        const value = list.get(i);
        if (typeof value === "string" && value !== "") {
          const next = visit(value);
          if (next !== undefined) {
            list.set(i, next);
          }
        }
      }
    }
  }
  if (plan.refId !== undefined && message.get(plan.refId.kind) === ORGANIZATION_KIND_NAME) {
    const value = message.get(plan.refId.id);
    if (typeof value === "string" && value !== "") {
      const next = visit(value);
      if (next !== undefined) {
        message.set(plan.refId.id, next);
      }
    }
  }
  for (const field of plan.nested) {
    if (!message.isSet(field)) {
      continue;
    }
    if (field.fieldKind === "message") {
      visitMessage(message.get(field), visit);
    } else if (field.fieldKind === "list") {
      const list = message.get(field);
      for (let i = 0; i < list.size; i++) {
        visitMessage(list.get(i) as ReflectMessage, visit);
      }
    } else if (field.fieldKind === "map") {
      for (const [, value] of message.get(field)) {
        visitMessage(value as ReflectMessage, visit);
      }
    }
  }
}

/** Visits the annotated field (rule 2), reached through singular message fields. */
function visitPath(message: ReflectMessage, path: string, visit: Visit): void {
  const segments = path.split(".");
  let holder: ReflectMessage = message;
  for (const segment of segments.slice(0, -1)) {
    const field = holder.desc.fields.find((f) => f.name === segment);
    if (field === undefined || field.fieldKind !== "message" || !holder.isSet(field)) {
      return;
    }
    holder = holder.get(field);
  }
  const last = holder.desc.fields.find(
    (f) => f.name === segments[segments.length - 1],
  );
  if (last === undefined || last.fieldKind !== "scalar") {
    return;
  }
  const value = holder.get(last);
  if (typeof value === "string" && value !== "") {
    const next = visit(value);
    if (next !== undefined) {
      holder.set(last, next);
    }
  }
}

/** Every organization value a request carries, by rule 1 to 3. */
function visitRequest(
  message: ReflectMessage,
  path: string | undefined,
  visit: Visit,
): void {
  visitMessage(message, visit);
  if (path !== undefined) {
    visitPath(message, path, visit);
  }
}

const annotatedPaths = new Map<DescMethod, string | undefined>();

/**
 * Every organization value a request carries, by rules 1 to 3, in the
 * order met (an id, or a name the resolver left as written): what the
 * deleting rule asks about (domain/organization/lifecycle.ts), read with
 * this module's one rule so the two cannot disagree on which fields name
 * an organization.
 */
export function organizationValuesOf(
  method: DescMethod,
  message: Message,
): string[] {
  if (!annotatedPaths.has(method)) {
    annotatedPaths.set(method, annotatedOrganizationPath(method));
  }
  const path = annotatedPaths.get(method);
  if (planOf(method.input) === null && path === undefined) {
    return [];
  }
  const values: string[] = [];
  visitRequest(reflect(method.input, message), path, (value) => {
    values.push(value);
    return undefined;
  });
  return values;
}

export function createOrganizationNameInterceptor(
  resolver: OrganizationNameResolver,
): Interceptor {
  const paths = new Map<DescMethod, string | undefined>();
  const pathOf = (method: DescMethod): string | undefined => {
    if (!paths.has(method)) {
      paths.set(method, annotatedOrganizationPath(method));
    }
    return paths.get(method);
  };
  return (next) => async (request) => {
    if (request.stream) {
      return next(request);
    }
    const path = pathOf(request.method);
    if (planOf(request.method.input) === null && path === undefined) {
      return next(request);
    }
    const names = new Set<string>();
    visitRequest(reflect(request.method.input, request.message), path, (value) => {
      if (!isOrganizationId(value)) {
        names.add(value);
      }
      return undefined;
    });
    if (names.size === 0) {
      return next(request);
    }
    const ids = new Map<string, string>();
    for (const name of names) {
      const id = await resolver.resolve(name);
      if (id !== undefined && id !== name) {
        ids.set(name, id);
      }
    }
    if (ids.size === 0) {
      return next(request);
    }
    const message = clone(request.method.input, request.message);
    visitRequest(reflect(request.method.input, message), path, (value) =>
      ids.get(value),
    );
    return next({ ...request, message });
  };
}

/**
 * Resolves, in place, every organization a message names by rules 1 and 3
 * (one lookup per distinct name): for content a person wrote that is read
 * on the server rather than received as a request. A name nothing holds is
 * left as written, as the interceptor leaves it.
 */
export async function resolveOrganizationNames(
  desc: DescMessage,
  message: Message,
  resolver: OrganizationNameResolver,
): Promise<void> {
  const names = new Set<string>();
  visitMessage(reflect(desc, message), (value) => {
    if (!isOrganizationId(value)) {
      names.add(value);
    }
    return undefined;
  });
  const ids = new Map<string, string>();
  for (const name of names) {
    const id = await resolver.resolve(name);
    if (id !== undefined && id !== name) {
      ids.set(name, id);
    }
  }
  if (ids.size > 0) {
    visitMessage(reflect(desc, message), (value) => ids.get(value));
  }
}
