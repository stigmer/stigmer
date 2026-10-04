/**
 * The frozen envelope two frozen data migrations decode retired agent
 * instance rows through: the resource envelope every kind shares
 * (api_version = 1, kind = 2, metadata = 3) under the retired message's
 * full name, built once from a hand-written descriptor that imports the
 * live metadata file.
 *
 * Why it exists. The organization-slug ledger (organization-slug-history.ts)
 * and the public-visibility mover (public-visibility-retired.ts) are
 * statements about the store as it was when they arrived, and each forbids
 * a later release from changing what it does; both list `agent_instance`
 * among their kinds. The agent instance kind has since been removed from
 * the contract, so its generated schema no longer exists, but a store that
 * replays the migration chain from an old version still holds its rows when
 * those two steps run (the later migration that removes the kind's rows
 * runs after them). Both steps read and edit `metadata` only, through
 * reflection, so the envelope is exactly what they need: protobuf-es keeps
 * the fields it does not declare (spec = 4, status = 5) as unknown fields
 * through `fromBinary` and writes them back verbatim in `toBinary`, after
 * the declared ones, in the order a whole-message encode writes them — so
 * a moved row's bytes are the bytes the retired schema wrote.
 *
 * Frozen: the envelope never changes. A migration that needs more of a
 * retired kind's message reads it by field number from these unknown
 * fields, never through a schema that no longer exists.
 */
import { create, createFileRegistry } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";

import { file_ai_stigmer_commons_apiresource_metadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

/** The retired message's full name, as its rows were written. */
const AGENT_INSTANCE_TYPE_NAME =
  "ai.stigmer.agentic.agentinstance.v1.AgentInstance";

const envelopeFile = create(FileDescriptorProtoSchema, {
  name: "stigmer-server/store/frozen/agent_instance_envelope.proto",
  package: "ai.stigmer.agentic.agentinstance.v1",
  dependency: [file_ai_stigmer_commons_apiresource_metadata.proto.name],
  syntax: "proto3",
  messageType: [
    {
      name: "AgentInstance",
      field: [
        {
          name: "api_version",
          jsonName: "apiVersion",
          number: 1,
          label: FieldDescriptorProto_Label.OPTIONAL,
          type: FieldDescriptorProto_Type.STRING,
        },
        {
          name: "kind",
          jsonName: "kind",
          number: 2,
          label: FieldDescriptorProto_Label.OPTIONAL,
          type: FieldDescriptorProto_Type.STRING,
        },
        {
          name: "metadata",
          jsonName: "metadata",
          number: 3,
          label: FieldDescriptorProto_Label.OPTIONAL,
          type: FieldDescriptorProto_Type.MESSAGE,
          typeName: ".ai.stigmer.commons.apiresource.ApiResourceMetadata",
        },
      ],
    },
  ],
});

/** The frozen envelope's schema (the module header). */
export const FrozenAgentInstanceEnvelopeSchema: DescMessage = (() => {
  const registry = createFileRegistry(envelopeFile, (protoFileName) =>
    protoFileName === file_ai_stigmer_commons_apiresource_metadata.proto.name
      ? file_ai_stigmer_commons_apiresource_metadata
      : undefined,
  );
  const message = registry.getMessage(AGENT_INSTANCE_TYPE_NAME);
  if (message === undefined) {
    throw new Error(
      `the frozen ${AGENT_INSTANCE_TYPE_NAME} envelope did not build`,
    );
  }
  return message;
})();
