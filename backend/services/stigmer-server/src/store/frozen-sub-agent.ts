/**
 * The frozen shape of a sub-agent written inside an agent (the retired
 * AgentSpec field 6, message ai.stigmer.agentic.agent.v1.SubAgent), and the
 * two operations the data migrations need on an agent row that still holds
 * them: read them, and write them back.
 *
 * Why it exists. A subagent became a saved agent the parent lists
 * (AgentSpec.subagents, 17), and the contract reserves field 6. Two
 * migrations still meet the old shape on a store that replays the chain:
 * the MCP server retirement (mcp-server-retired.ts), which renames a
 * sub-agent's tool entries and moves its plugin skills to the parent's
 * plugins, and the sub-agent retirement (sub-agents-retired.ts), which
 * drops each one and logs it as an agent manifest. protobuf-es keeps a
 * field its schema no longer declares as an unknown field through
 * `fromBinary` and writes it back verbatim in `toBinary`, so both read the
 * field by number and decode its bytes through this hand-written
 * descriptor.
 *
 * Frozen: the descriptor is the message as its rows were written (fields
 * 1, 2, 3, 5, 6, 7 and 8; field 4 was already reserved) and never changes.
 */
import { create, createFileRegistry, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { BinaryReader, BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";

import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { file_ai_stigmer_commons_apiresource_io } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

/** The retired AgentSpec field that held sub-agents. */
export const AGENT_SPEC_SUB_AGENTS_FIELD = 6;

/** A sub-agent as its rows were written. */
export interface FrozenSubAgent {
  name: string;
  description: string;
  instructions: string;
  skillRefs: ApiResourceReference[];
  modelOverride: string;
  tools: string[];
  disallowedTools: string[];
}

const TYPE_NAME = "ai.stigmer.agentic.agent.v1.SubAgent";

/** The frozen descriptor (the module header). */
export const FrozenSubAgentSchema: DescMessage = buildSchema();

function buildSchema(): DescMessage {
  const string = (name: string, jsonName: string, number: number) => ({
    name,
    jsonName,
    number,
    label: FieldDescriptorProto_Label.OPTIONAL,
    type: FieldDescriptorProto_Type.STRING,
  });
  const strings = (name: string, jsonName: string, number: number) => ({
    ...string(name, jsonName, number),
    label: FieldDescriptorProto_Label.REPEATED,
  });
  const file = create(FileDescriptorProtoSchema, {
    name: "stigmer-server/store/frozen/ai.stigmer.agentic.agent.v1.SubAgent.proto",
    package: "ai.stigmer.agentic.agent.v1",
    dependency: [file_ai_stigmer_commons_apiresource_io.proto.name],
    syntax: "proto3",
    messageType: [
      {
        name: "SubAgent",
        field: [
          string("name", "name", 1),
          string("description", "description", 2),
          string("instructions", "instructions", 3),
          {
            name: "skill_refs",
            jsonName: "skillRefs",
            number: 5,
            label: FieldDescriptorProto_Label.REPEATED,
            type: FieldDescriptorProto_Type.MESSAGE,
            typeName: ".ai.stigmer.commons.apiresource.ApiResourceReference",
          },
          string("model_override", "modelOverride", 6),
          strings("tools", "tools", 7),
          strings("disallowed_tools", "disallowedTools", 8),
        ],
      },
    ],
  });
  const registry = createFileRegistry(file, (protoFileName) =>
    protoFileName === file_ai_stigmer_commons_apiresource_io.proto.name
      ? file_ai_stigmer_commons_apiresource_io
      : undefined,
  );
  const message = registry.getMessage(TYPE_NAME);
  if (message === undefined) {
    /* v8 ignore next -- @preserve: an invariant over this module's constant descriptor, which always declares the message; it runs once at import, where no test can make the registry lose it */
    throw new Error("the frozen SubAgent descriptor did not build");
  }
  return message;
}

type UnknownField = { readonly no: number; readonly wireType: WireType; readonly data: Uint8Array };
type UnknownHolder = { $unknown?: UnknownField[] };

/** The sub-agents an agent spec still holds as unknown fields, in order. */
export function readSubAgents(spec: object): FrozenSubAgent[] {
  return ((spec as UnknownHolder).$unknown ?? [])
    .filter((f) => f.no === AGENT_SPEC_SUB_AGENTS_FIELD && f.wireType === WireType.LengthDelimited)
    .map((f) => fromBinary(FrozenSubAgentSchema, new BinaryReader(f.data).bytes()) as unknown as FrozenSubAgent);
}

/**
 * Replaces the sub-agents an agent spec holds with `subAgents`, written
 * where the first one was (or at the end), so a spec that keeps them keeps
 * its field order; an empty list removes the field.
 */
export function writeSubAgents(spec: object, subAgents: readonly FrozenSubAgent[]): void {
  const holder = spec as UnknownHolder;
  const unknown = holder.$unknown ?? [];
  const first = unknown.findIndex((f) => f.no === AGENT_SPEC_SUB_AGENTS_FIELD);
  const rest = unknown.filter((f) => f.no !== AGENT_SPEC_SUB_AGENTS_FIELD);
  const encoded: UnknownField[] = subAgents.map((subAgent) => ({
    no: AGENT_SPEC_SUB_AGENTS_FIELD,
    wireType: WireType.LengthDelimited,
    data: new BinaryWriter()
      .bytes(toBinary(FrozenSubAgentSchema, create(FrozenSubAgentSchema, { ...subAgent })))
      .finish(),
  }));
  const at = first === -1 ? rest.length : unknown.slice(0, first).filter((f) => f.no !== AGENT_SPEC_SUB_AGENTS_FIELD).length;
  const next = [...rest.slice(0, at), ...encoded, ...rest.slice(at)];
  if (next.length === 0) {
    delete holder.$unknown;
  } else {
    holder.$unknown = next;
  }
}
