/**
 * The reference fill — an interceptor on BOTH chains (pipeline/chain.ts),
 * so one RPC answers the same whichever transport calls it: the console
 * over the wire, and server and composition code in process.
 *
 * A stored reference holds its target's id and no slug
 * (pipeline/steps/references.ts, NormalizeReferences), so a reference
 * keeps meaning the resource it meant across a rename and never means a
 * new resource that takes a deleted one's name. People read names, so on
 * the way out this fills the `slug` of every ApiResourceReference a
 * response carries that holds an id, with its target's CURRENT name, and
 * its `kind` where it is empty with the kind its field declares
 * (`reference_kind`). A target that is gone holds no name, and its
 * reference keeps an empty slug: that is how a reader tells a deleted
 * target from a live one.
 *
 * One batched read of the name table per response
 * (ResourceNameStore.currentMany), and for a stream one per frame
 * (run.subscribe), wrapped as the error boundary wraps a stream's frames.
 * Which fields of a message type can reach a reference is planned once per
 * type and memoised, as the organization-name resolver plans its fields,
 * so a response that can reach no reference passes untouched. A response
 * that carries a reference to fill is answered as a filled clone, never a
 * mutation of the handler's message.
 *
 * Proven by __tests__/resource-references.test.ts and the reference arms
 * of the conformance suite.
 */
import { clone, getOption, hasOption } from "@bufbuild/protobuf";
import type { DescField, DescMessage, Message } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import type { Interceptor } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { reference_kind } from "@stigmer/protos/ai/stigmer/commons/apiresource/field_options_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { ResourceNameStore } from "../../store/interface.js";
import { kindEnumName } from "../apiresource-meta.js";

/** How one message type can hold references: its own reference fields, and the message fields that may hold more. */
interface MessagePlan {
  readonly references: readonly DescField[];
  readonly nested: readonly DescField[];
}

const plans = new Map<string, MessagePlan | null>();
const reaches = new Map<string, boolean>();

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

function isReference(message: DescMessage): boolean {
  return message.typeName === ApiResourceReferenceSchema.typeName;
}

/**
 * Whether any value a message type can hold, at any depth, is a reference.
 * A cycle is cut by `visiting`; a "no" found while a cycle was cut may be
 * wrong, so only a "yes" or a complete search is memoised.
 */
function reachesReference(
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
  const result = message.fields.some((field) => {
    const child = childMessageOf(field);
    return (
      child !== undefined &&
      (isReference(child) || reachesReference(child, visiting))
    );
  });
  visiting.delete(message.typeName);
  if (result || visiting.size === 0) {
    reaches.set(message.typeName, result);
  }
  return result;
}

/** The plan for a message type, or null when no value it can hold is a reference. Built once per type. */
function planOf(message: DescMessage): MessagePlan | null {
  const known = plans.get(message.typeName);
  if (known !== undefined) {
    return known;
  }
  if (!reachesReference(message)) {
    plans.set(message.typeName, null);
    return null;
  }
  const references: DescField[] = [];
  const nested: DescField[] = [];
  for (const field of message.fields) {
    const child = childMessageOf(field);
    if (child === undefined) {
      continue;
    }
    if (isReference(child)) {
      references.push(field);
    } else if (reachesReference(child)) {
      nested.push(field);
    }
  }
  const plan = { references, nested };
  plans.set(message.typeName, plan);
  return plan;
}

/** Visits every reference a message holds, with the field that holds it. */
function visitReferences(
  message: ReflectMessage,
  visit: (ref: ReflectMessage, field: DescField) => void,
): void {
  const plan = planOf(message.desc);
  if (plan === null) {
    return;
  }
  const each = (field: DescField, fn: (value: ReflectMessage) => void) => {
    if (!message.isSet(field)) {
      return;
    }
    if (field.fieldKind === "message") {
      fn(message.get(field));
    } else if (field.fieldKind === "list") {
      for (const item of message.get(field)) {
        fn(item as ReflectMessage);
      }
    } else if (field.fieldKind === "map") {
      for (const [, value] of message.get(field)) {
        fn(value as ReflectMessage);
      }
    }
  };
  for (const field of plan.references) {
    each(field, (ref) => visit(ref, field));
  }
  for (const field of plan.nested) {
    each(field, (child) => visitReferences(child, visit));
  }
}

function stringOf(ref: ReflectMessage, name: string): string {
  const field = ref.desc.fields.find((f) => f.name === name);
  const value = field === undefined ? undefined : ref.get(field);
  return typeof value === "string" ? value : "";
}

function fieldOf(ref: ReflectMessage, name: string): DescField {
  const field = ref.desc.fields.find((f) => f.name === name);
  if (field === undefined) {
    throw new Error(`ApiResourceReference has no field ${name}`);
  }
  return field;
}

/** The kind a reference names: its own, else the kind its field declares. */
function kindOf(ref: ReflectMessage, field: DescField): ApiResourceKind {
  const own = ref.get(fieldOf(ref, "kind"));
  if (typeof own === "number" && own !== ApiResourceKind.api_resource_kind_unknown) {
    return own as ApiResourceKind;
  }
  return hasOption(field, reference_kind)
    ? getOption(field, reference_kind)
    : ApiResourceKind.api_resource_kind_unknown;
}

/**
 * Fills, in place, the slug (and an empty kind) of every reference the
 * message holds that names an id: one batched read. Reports whether the
 * message holds any such reference. Exported for the code that reads a
 * stored row outside an RPC and hands it to a person.
 */
export async function fillReferenceNames(
  names: Pick<ResourceNameStore, "currentMany">,
  desc: DescMessage,
  message: Message,
): Promise<boolean> {
  const found: Array<{ ref: ReflectMessage; kind: ApiResourceKind }> = [];
  visitReferences(reflect(desc, message), (ref, field) => {
    if (stringOf(ref, "id") !== "") {
      found.push({ ref, kind: kindOf(ref, field) });
    }
  });
  if (found.length === 0) {
    return false;
  }
  const keyOf = (kind: string, org: string, id: string) => `${kind}/${org}/${id}`;
  const holders = new Map<string, { kind: string; org: string; id: string }>();
  for (const { ref, kind } of found) {
    const holder = {
      kind: kindEnumName(kind),
      org: stringOf(ref, "org"),
      id: stringOf(ref, "id"),
    };
    holders.set(keyOf(holder.kind, holder.org, holder.id), holder);
  }
  const entries = await names.currentMany([...holders.values()]);
  const current = new Map(
    entries.map((entry) => [keyOf(entry.kind, entry.org, entry.id), entry.name]),
  );
  for (const { ref, kind } of found) {
    ref.set(fieldOf(ref, "kind"), kind);
    ref.set(
      fieldOf(ref, "slug"),
      current.get(
        keyOf(kindEnumName(kind), stringOf(ref, "org"), stringOf(ref, "id")),
      ) ?? "",
    );
  }
  return true;
}

/** Whether a message type can hold a reference at all (the memoised plan). */
export function reachesResourceReference(desc: DescMessage): boolean {
  return planOf(desc) !== null;
}

/** A filled clone of `message`, or `message` itself when it holds no reference to fill. */
async function filled<T extends Message>(
  names: Pick<ResourceNameStore, "currentMany">,
  desc: DescMessage,
  message: T,
): Promise<T> {
  if (planOf(desc) === null) {
    return message;
  }
  const copy = clone(desc, message) as T;
  return (await fillReferenceNames(names, desc, copy)) ? copy : message;
}

async function* filledFrames<T extends Message>(
  names: Pick<ResourceNameStore, "currentMany">,
  desc: DescMessage,
  frames: AsyncIterable<T>,
): AsyncIterable<T> {
  for await (const frame of frames) {
    yield await filled(names, desc, frame);
  }
}

export function createResourceReferenceInterceptor(
  names: Pick<ResourceNameStore, "currentMany">,
): Interceptor {
  return (next) => async (request) => {
    const response = await next(request);
    const desc = request.method.output;
    if (planOf(desc) === null) {
      return response;
    }
    if (response.stream) {
      return {
        ...response,
        message: filledFrames(names, desc, response.message),
      };
    }
    return { ...response, message: await filled(names, desc, response.message) };
  };
}
