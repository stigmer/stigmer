/**
 * The frozen envelopes the frozen data migrations decode the rows of
 * retired kinds through: the resource envelope every kind shares
 * (api_version = 1, kind = 2, metadata = 3) under each retired message's
 * full name, built by one builder from a hand-written descriptor that
 * imports the live metadata file.
 *
 * Why they exist. The organization-slug ledger (organization-slug-history.ts)
 * and the public-visibility mover (public-visibility-retired.ts) are
 * statements about the store as it was when they arrived, and each forbids
 * a later release from changing what it does; between them they list
 * `agent_instance`, `workflow_instance`, `workflow`, `workflow_execution`,
 * `environment`, `artifact` and `mcp_server` among their kinds, and they
 * and the name backfill (resource-names-backfill.ts) and the reference
 * rewrite (references-by-id.ts) list `platform_client`, `plugin_eval` and
 * `agent_eval`. Those kinds have since been removed
 * from the contract, so their generated schemas no longer exist, but a
 * store that replays the migration chain from an old version still holds
 * their rows when those two steps run (the later migrations that remove the
 * rows, agent-instance-retired.ts, workflow-instance-retired.ts,
 * workflow-retired.ts, environment-retired.ts, mcp-server-retired.ts,
 * platform-client-retired.ts and eval-kinds-retired.ts, run after them). Both steps read and edit `metadata`
 * only, through reflection, so an envelope is exactly what they need:
 * protobuf-es keeps the fields it does not declare (spec = 4, status = 5)
 * as unknown fields through `fromBinary` and writes them back verbatim in
 * `toBinary`, after the declared ones, in the order a whole-message encode
 * writes them — so a moved row's bytes are the bytes the retired schema
 * wrote.
 *
 * Frozen: an envelope never changes. A migration that needs more of a
 * retired kind's message reads it by field number from these unknown
 * fields, never through a schema that no longer exists. Each envelope
 * carries its retired message's own full name, the name its rows were
 * written under.
 *
 * Two shapes carry more than metadata: the AgentShare and AgentChannel
 * rows' (the two kinds merged into Channel, channel-kinds-merged.ts). The
 * reference rewrite (references-by-id.ts) walks every reference under a
 * row's spec by each field's `reference_kind`, so a store replayed from
 * before it must still find those rows' references or keep slug-only
 * references the next write refuses. Each of the two declares its spec
 * (field 4) with exactly its reference fields, at their numbers and with
 * their declared kinds, and its status (field 5) with exactly its audit
 * (field 99), whose creation time the name backfill (resource-names-
 * backfill.ts) orders two rows sharing a slug by; nothing else: every other
 * field stays an unknown field, written back verbatim, and the merge reads
 * the rest by number.
 */
import { create, createFileRegistry, setExtension } from "@bufbuild/protobuf";
import type { DescFile, DescMessage } from "@bufbuild/protobuf";
import {
  DescriptorProtoSchema,
  FieldDescriptorProtoSchema,
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FieldOptionsSchema,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
import type { DescriptorProto, FieldDescriptorProto } from "@bufbuild/protobuf/wkt";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { reference_kind } from "@stigmer/apis/ai/stigmer/commons/apiresource/field_options_pb";
import { file_ai_stigmer_commons_apiresource_io } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { file_ai_stigmer_commons_apiresource_metadata } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { file_ai_stigmer_commons_apiresource_status } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";

/** The envelope of a retired AgentInstance row. */
export const FrozenAgentInstanceEnvelopeSchema = frozenEnvelope(
  "ai.stigmer.agentic.agentinstance.v1.AgentInstance",
);

/** The envelope of a retired WorkflowInstance row. */
export const FrozenWorkflowInstanceEnvelopeSchema = frozenEnvelope(
  "ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance",
);

/** The envelope of a retired Workflow row. */
export const FrozenWorkflowEnvelopeSchema = frozenEnvelope(
  "ai.stigmer.agentic.workflow.v1.Workflow",
);

/** The envelope of a retired workflow run row (kind `workflow_execution`). */
export const FrozenWorkflowExecutionEnvelopeSchema = frozenEnvelope(
  "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution",
);

/** The envelope of a retired Artifact row. */
export const FrozenArtifactEnvelopeSchema = frozenEnvelope(
  "ai.stigmer.agentic.artifact.v1.Artifact",
);

/** The envelope of a retired Environment row. */
export const FrozenEnvironmentEnvelopeSchema = frozenEnvelope(
  "ai.stigmer.agentic.environment.v1.Environment",
);

/** The envelope of a retired McpServer row. */
export const FrozenMcpServerEnvelopeSchema = frozenEnvelope(
  "ai.stigmer.agentic.mcpserver.v1.McpServer",
);

/** The envelope of a retired PlatformClient row. */
export const FrozenPlatformClientEnvelopeSchema = frozenEnvelope(
  "ai.stigmer.iam.platformclient.v1.PlatformClient",
);

/** The envelope of a retired PluginEval row. */
export const FrozenPluginEvalEnvelopeSchema = frozenEnvelope(
  "ai.stigmer.agentic.plugineval.v1.PluginEval",
);

/** The envelope of a retired AgentEval row. */
export const FrozenAgentEvalEnvelopeSchema = frozenEnvelope(
  "ai.stigmer.agentic.agenteval.v1.AgentEval",
);

/**
 * A retired AgentShare row: the envelope, a spec (AgentShareSpec)
 * declaring its two reference fields, agent_ref (1) and vaults (8), and a
 * status declaring its audit.
 */
export const FrozenAgentShareSchema = frozenEnvelope(
  "ai.stigmer.agentic.agentshare.v1.AgentShare",
  [
    { name: "agent_ref", number: 1, kind: ApiResourceKind.agent },
    { name: "vaults", number: 8, kind: ApiResourceKind.vault, repeated: true },
  ],
);

/**
 * A retired AgentChannel row: the envelope, a spec (AgentChannelSpec)
 * declaring its three reference fields, agent_ref (1), app_ref (5) and
 * vaults (9), and a status declaring its audit.
 */
export const FrozenAgentChannelSchema = frozenEnvelope(
  "ai.stigmer.agentic.agentchannel.v1.AgentChannel",
  [
    { name: "agent_ref", number: 1, kind: ApiResourceKind.agent },
    { name: "app_ref", number: 5, kind: ApiResourceKind.channel_app },
    { name: "vaults", number: 9, kind: ApiResourceKind.vault, repeated: true },
  ],
);

/** One reference field a frozen spec declares, with the kind its field option declared. */
interface FrozenReferenceField {
  readonly name: string;
  readonly number: number;
  readonly kind: ApiResourceKind;
  readonly repeated?: boolean;
}

/** A reference field's descriptor, its `reference_kind` option set as the live contract sets it. */
function referenceField(field: FrozenReferenceField): FieldDescriptorProto {
  const options = create(FieldOptionsSchema);
  setExtension(options, reference_kind, field.kind);
  return create(FieldDescriptorProtoSchema, {
    name: field.name,
    jsonName: field.name.replace(/_([a-z])/g, (_match: string, letter: string) => letter.toUpperCase()),
    number: field.number,
    label: field.repeated === true ? FieldDescriptorProto_Label.REPEATED : FieldDescriptorProto_Label.OPTIONAL,
    type: FieldDescriptorProto_Type.MESSAGE,
    typeName: ".ai.stigmer.commons.apiresource.ApiResourceReference",
    options,
  });
}

/**
 * The envelope's schema under `typeName`, a retired message's full name
 * (the module header); with `specReferences`, also a spec (field 4) of
 * message `<name>Spec` declaring exactly those reference fields, and a
 * status (field 5) of message `<name>Status` declaring its audit (99).
 */
function frozenEnvelope(
  typeName: string,
  specReferences?: ReadonlyArray<FrozenReferenceField>,
): DescMessage {
  const split = typeName.lastIndexOf(".");
  const packageName = typeName.slice(0, split);
  const messageName = typeName.slice(split + 1);
  const specMessages: DescriptorProto[] =
    specReferences === undefined
      ? []
      : [
          create(DescriptorProtoSchema, {
            name: `${messageName}Spec`,
            field: specReferences.map(referenceField),
          }),
          create(DescriptorProtoSchema, {
            name: `${messageName}Status`,
            field: [
              {
                name: "audit",
                jsonName: "audit",
                number: 99,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.MESSAGE,
                typeName: ".ai.stigmer.commons.apiresource.ApiResourceAudit",
              },
            ],
          }),
        ];
  const specFields =
    specReferences === undefined
      ? []
      : [
          {
            name: "spec",
            jsonName: "spec",
            number: 4,
            label: FieldDescriptorProto_Label.OPTIONAL,
            type: FieldDescriptorProto_Type.MESSAGE,
            typeName: `.${packageName}.${messageName}Spec`,
          },
          {
            name: "status",
            jsonName: "status",
            number: 5,
            label: FieldDescriptorProto_Label.OPTIONAL,
            type: FieldDescriptorProto_Type.MESSAGE,
            typeName: `.${packageName}.${messageName}Status`,
          },
        ];
  const dependencies: ReadonlyArray<DescFile> =
    specReferences === undefined
      ? [file_ai_stigmer_commons_apiresource_metadata]
      : [
          file_ai_stigmer_commons_apiresource_metadata,
          file_ai_stigmer_commons_apiresource_io,
          file_ai_stigmer_commons_apiresource_status,
        ];
  const file = create(FileDescriptorProtoSchema, {
    name: `stigmer-server/store/frozen/${packageName}.${messageName}.proto`,
    package: packageName,
    dependency: dependencies.map((dependency) => dependency.proto.name),
    syntax: "proto3",
    messageType: [
      ...specMessages,
      {
        name: messageName,
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
          ...specFields,
        ],
      },
    ],
  });
  const registry = createFileRegistry(file, (protoFileName) =>
    dependencies.find((dependency) => dependency.proto.name === protoFileName),
  );
  const message = registry.getMessage(typeName);
  if (message === undefined) {
    /* v8 ignore next -- @preserve: an invariant over this module's constant descriptor, which always declares the message; it runs once per envelope at import, where no test can make the registry lose it */
    throw new Error(`the frozen ${typeName} envelope did not build`);
  }
  return message;
}
