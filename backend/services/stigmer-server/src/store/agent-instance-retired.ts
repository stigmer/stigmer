/**
 * The one data migration both store drivers run when the agent instance
 * kind is removed: every session that ran against an instance names the
 * instance's agent directly, and the instance rows leave the store. The
 * drivers own the SQL (which rows to read, in what pages, how to write
 * them, the transaction); this module owns what is edition- and
 * driver-neutral: how a retired instance row names its agent, and what one
 * session row becomes.
 *
 * What a session becomes. A session stored before the release holds its
 * instance id in SessionSpec field 1, which the contract now reserves, so
 * the current schema decodes it as an unknown field (protobuf-es keeps
 * unknown fields through `fromBinary`). It is read by wire number, never
 * through a schema that no longer exists, and dropped:
 *
 *   - the instance survives and its agent exists: the session names that
 *     agent (spec.agent_ref, by the agent's organization id and slug) and
 *     pins its current version (status.agent_id, agent_version_hash) — the
 *     agent and version the instance ran;
 *   - the instance survives but its agent is gone: the session keeps the
 *     agent's id with no reference, and its next turn fails naming the
 *     agent, as any conversation whose agent is deleted does;
 *   - the instance is gone (agent delete cascaded its instances): no agent
 *     identity is left anywhere in the store, and the session continues
 *     with the built-in assistant;
 *   - a session that named no instance (the built-in assistant) is left
 *     byte for byte as it is.
 *
 * Agent rows and agent executions are not rewritten: an agent's retired
 * default-instance pointer rides as an unknown field no reader decodes, and
 * a turn keeps the history it was created with (recover records a session's
 * pin on a turn that recorded no agent, when it runs it). The list keys of
 * the removed rows go with them; their search entries are boot's rebuild's
 * to drop.
 *
 * An undecodable row fails the step, the rule the other data migrations
 * keep (public-visibility-retired.ts): the driver's transaction rolls back
 * and the boot stops on the row it names.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { FrozenAgentInstanceEnvelopeSchema } from "./frozen-agent-instance.js";

/** The `kind` column values the step reads and removes. */
export const RETIRED_INSTANCE_KIND = "agent_instance";
export const SESSION_KIND = "session";
export const AGENT_KIND = "agent";

/** How many session rows the step decodes per page. */
export const RETIREMENT_PAGE_SIZE = 500;

/** The retired SessionSpec field that held the instance id. */
const SESSION_SPEC_INSTANCE_FIELD = 1;
/** The retired AgentInstance fields: spec, and spec.agent_id within it. */
const INSTANCE_SPEC_FIELD = 4;
const INSTANCE_SPEC_AGENT_FIELD = 1;

/** The agent a surviving instance names, as the step resolved it. */
export type InstanceAgent =
  | {
      readonly kind: "agent";
      readonly agentId: string;
      readonly org: string;
      readonly slug: string;
      readonly versionHash: string;
    }
  | { readonly kind: "agent-gone"; readonly agentId: string };

/**
 * The agent id a retired instance row names (spec.agent_id), or "" when
 * it names none. Throws when the bytes do not decode.
 */
export function instanceAgentIdOf(data: Uint8Array): string {
  const envelope = fromBinary(FrozenAgentInstanceEnvelopeSchema, data);
  const spec = lastLengthDelimited(envelope.$unknown, INSTANCE_SPEC_FIELD);
  if (spec === undefined) {
    return "";
  }
  return stringField(spec, INSTANCE_SPEC_AGENT_FIELD) ?? "";
}

/** What the step knows of an agent row it read: the id, org, slug and head hash. */
export function agentFactsOf(data: Uint8Array): InstanceAgent {
  const agent = fromBinary(AgentSchema, data);
  return {
    kind: "agent",
    agentId: agent.metadata?.id ?? "",
    org: agent.metadata?.org ?? "",
    slug: agent.metadata?.slug ?? "",
    versionHash: agent.status?.versionHash ?? "",
  };
}

/** The instance id a stored session row names in its retired field, or "". */
export function sessionInstanceIdOf(session: Session): string {
  const held = lastLengthDelimited(
    session.spec?.$unknown,
    SESSION_SPEC_INSTANCE_FIELD,
  );
  return held === undefined ? "" : new TextDecoder().decode(held);
}

/**
 * The migrated bytes of one session row, or undefined when it names no
 * instance (the driver then leaves its bytes as they are). `agentOf`
 * answers the agent a surviving instance names, or undefined when the
 * instance is gone. Throws when the bytes do not decode.
 */
export function migrateSessionRow(
  data: Uint8Array,
  agentOf: (instanceId: string) => InstanceAgent | undefined,
): Uint8Array | undefined {
  const session = fromBinary(SessionSchema, data);
  const instanceId = sessionInstanceIdOf(session);
  const spec = session.spec;
  if (
    spec === undefined ||
    !(spec.$unknown ?? []).some((f) => f.no === SESSION_SPEC_INSTANCE_FIELD)
  ) {
    return undefined;
  }
  spec.$unknown = (spec.$unknown ?? []).filter(
    (f) => f.no !== SESSION_SPEC_INSTANCE_FIELD,
  );
  if (spec.$unknown.length === 0) {
    delete spec.$unknown;
  }
  const agent = instanceId === "" ? undefined : agentOf(instanceId);
  if (agent !== undefined) {
    const status = (session.status ??= create(SessionStatusSchema));
    status.agentId = agent.agentId;
    if (agent.kind === "agent") {
      spec.agentRef = create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.agent,
        org: agent.org,
        slug: agent.slug,
      });
      status.agentVersionHash = agent.versionHash;
    }
  }
  return toBinary(SessionSchema, session);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableRowError(
  kind: string,
  id: string,
  error: unknown,
): Error {
  return new Error(
    `${kind} '${id}' cannot be read to retire the agent instance kind: ${String(error)}`,
    { cause: error },
  );
}

type UnknownFields = ReadonlyArray<{
  readonly no: number;
  readonly wireType: WireType;
  readonly data: Uint8Array;
}>;

/**
 * The content of the last occurrence of a length-delimited unknown field
 * (proto's last-one-wins for a singular field), without its length prefix.
 */
function lastLengthDelimited(
  fields: UnknownFields | undefined,
  no: number,
): Uint8Array | undefined {
  const held = (fields ?? []).filter(
    (f) => f.no === no && f.wireType === WireType.LengthDelimited,
  );
  const last = held[held.length - 1];
  return last === undefined ? undefined : new BinaryReader(last.data).bytes();
}

/** A string field of an encoded message, by number; the last one wins. */
function stringField(message: Uint8Array, no: number): string | undefined {
  const reader = new BinaryReader(message);
  let value: string | undefined;
  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === no && wireType === WireType.LengthDelimited) {
      value = reader.string();
    } else {
      reader.skip(wireType, fieldNo);
    }
  }
  return value;
}
