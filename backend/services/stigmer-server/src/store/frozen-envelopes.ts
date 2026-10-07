/**
 * The frozen envelopes two frozen data migrations decode the rows of
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
 * `artifact` and `environment` among their kinds. Those kinds have since
 * been removed from the contract, so their generated schemas no longer
 * exist, but a store that replays the migration chain from an old version
 * still holds their rows when those two steps run (the later migrations
 * that remove the rows, agent-instance-retired.ts,
 * workflow-instance-retired.ts, workflow-retired.ts and
 * environment-retired.ts, run after them). Both steps read and edit `metadata`
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
 */
import { create, createFileRegistry } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";

import { file_ai_stigmer_commons_apiresource_metadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

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

/** The envelope's schema under `typeName`, a retired message's full name (the module header). */
function frozenEnvelope(typeName: string): DescMessage {
  const split = typeName.lastIndexOf(".");
  const packageName = typeName.slice(0, split);
  const messageName = typeName.slice(split + 1);
  const file = create(FileDescriptorProtoSchema, {
    name: `stigmer-server/store/frozen/${packageName}.${messageName}.proto`,
    package: packageName,
    dependency: [file_ai_stigmer_commons_apiresource_metadata.proto.name],
    syntax: "proto3",
    messageType: [
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
        ],
      },
    ],
  });
  const registry = createFileRegistry(file, (protoFileName) =>
    protoFileName === file_ai_stigmer_commons_apiresource_metadata.proto.name
      ? file_ai_stigmer_commons_apiresource_metadata
      : undefined,
  );
  const message = registry.getMessage(typeName);
  if (message === undefined) {
    /* v8 ignore next -- @preserve: an invariant over this module's constant descriptor, which always declares the message; it runs once per envelope at import, where no test can make the registry lose it */
    throw new Error(`the frozen ${typeName} envelope did not build`);
  }
  return message;
}
