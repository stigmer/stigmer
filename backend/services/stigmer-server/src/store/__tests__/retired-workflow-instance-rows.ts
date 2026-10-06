/**
 * Test support: the bytes an earlier release wrote for the rows the
 * workflow instance kind's removal migrates, built by wire number because
 * the schemas that wrote them no longer exist — a WorkflowInstance row
 * (api_version 1, kind 2, metadata 3, spec 4 { workflow_id 1,
 * description 2, environment_refs 3, execution_visibility 4 }, status 5),
 * a WorkflowExecution row whose spec carries the retired
 * workflow_instance_id (field 1) and callback_token (field 7), and a
 * Workflow row whose status carries the retired default_instance_id
 * (field 1). Shared by the module's unit test, the frozen-envelope test
 * and both drivers' migration tests, so every one reads the same old shape.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/status_pb";
import {
  WorkflowRunSchema,
  WorkflowRunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { WorkflowRunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditStatusSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

type MetadataInit = MessageInitShape<typeof ApiResourceMetadataSchema>;

/** A WorkflowInstance row as an earlier release stored it. */
export function retiredWorkflowInstanceRow(options: {
  readonly metadata: MetadataInit;
  readonly workflowId: string;
  readonly description?: string;
  readonly environmentRefs?: ReadonlyArray<
    MessageInitShape<typeof ApiResourceReferenceSchema>
  >;
  /** The retired WorkflowExecutionVisibility number; 0 is not written. */
  readonly executionVisibility?: number;
}): Uint8Array {
  const spec = new BinaryWriter();
  if (options.workflowId !== "") {
    spec.tag(1, WireType.LengthDelimited).string(options.workflowId);
  }
  if ((options.description ?? "") !== "") {
    spec.tag(2, WireType.LengthDelimited).string(options.description ?? "");
  }
  for (const ref of options.environmentRefs ?? []) {
    spec
      .tag(3, WireType.LengthDelimited)
      .bytes(
        toBinary(
          ApiResourceReferenceSchema,
          create(ApiResourceReferenceSchema, ref),
        ),
      );
  }
  if ((options.executionVisibility ?? 0) !== 0) {
    spec.tag(4, WireType.Varint).int32(options.executionVisibility ?? 0);
  }
  const status = toBinary(
    ApiResourceAuditStatusSchema,
    create(ApiResourceAuditStatusSchema, {
      audit: { specAudit: { event: "created" } },
    }),
  );
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string("WorkflowInstance")
    .tag(3, WireType.LengthDelimited)
    .bytes(metadataBytes(options.metadata))
    .tag(4, WireType.LengthDelimited)
    .bytes(spec.finish())
    .tag(5, WireType.LengthDelimited)
    .bytes(status)
    .finish();
}

/**
 * A WorkflowExecution row as an earlier release stored it: the retired
 * instance id written ahead of the given spec as field 1 (omitted when
 * empty, as proto3 omits an empty string), the retired callback token
 * after it as field 7 (when given), and the status it carried.
 */
export function retiredWorkflowExecutionRow(options: {
  readonly metadata: MetadataInit;
  readonly instanceId: string;
  readonly callbackToken?: Uint8Array;
  readonly spec?: MessageInitShape<typeof WorkflowRunSpecSchema>;
  readonly status?: MessageInitShape<typeof WorkflowRunStatusSchema>;
}): Uint8Array {
  const spec = new BinaryWriter();
  if (options.instanceId !== "") {
    spec.tag(1, WireType.LengthDelimited).string(options.instanceId);
  }
  spec.raw(
    toBinary(
      WorkflowRunSpecSchema,
      create(WorkflowRunSpecSchema, options.spec ?? {}),
    ),
  );
  if (options.callbackToken !== undefined) {
    spec.tag(7, WireType.LengthDelimited).bytes(options.callbackToken);
  }
  const row = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string("WorkflowExecution")
    .tag(3, WireType.LengthDelimited)
    .bytes(metadataBytes(options.metadata))
    .tag(4, WireType.LengthDelimited)
    .bytes(spec.finish());
  if (options.status !== undefined) {
    row
      .tag(5, WireType.LengthDelimited)
      .bytes(
        toBinary(
          WorkflowRunStatusSchema,
          create(WorkflowRunStatusSchema, options.status),
        ),
      );
  }
  return row.finish();
}

/** The current encoding of a run (the envelope retiredWorkflowExecutionRow writes), for byte comparisons. */
export function workflowExecutionBytes(
  init: MessageInitShape<typeof WorkflowRunSchema>,
): Uint8Array {
  return toBinary(
    WorkflowRunSchema,
    create(WorkflowRunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "WorkflowExecution",
      ...init,
    }),
  );
}

/**
 * A Workflow row as an earlier release stored it: the retired
 * default_instance_id written ahead of the status's current fields.
 */
export function retiredWorkflowRow(options: {
  readonly metadata: MetadataInit;
  readonly defaultInstanceId: string;
  readonly versionHash: string;
}): Uint8Array {
  const status = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(options.defaultInstanceId)
    .raw(
      toBinary(
        WorkflowStatusSchema,
        create(WorkflowStatusSchema, { versionHash: options.versionHash }),
      ),
    )
    .finish();
  const current = toBinary(
    WorkflowSchema,
    create(WorkflowSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Workflow",
      metadata: options.metadata,
    }),
  );
  return new BinaryWriter()
    .raw(current)
    .tag(5, WireType.LengthDelimited)
    .bytes(status)
    .finish();
}

function metadataBytes(init: MetadataInit): Uint8Array {
  return toBinary(
    ApiResourceMetadataSchema,
    create(ApiResourceMetadataSchema, init),
  );
}
