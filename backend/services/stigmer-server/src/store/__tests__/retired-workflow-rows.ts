/**
 * Test support: the bytes an earlier release wrote for the rows of the
 * retired workflow kinds, built by wire number because the schemas that
 * wrote them no longer exist —
 *   - a WorkflowInstance row (api_version 1, kind 2, metadata 3, spec 4
 *     { workflow_id 1, description 2, environment_refs 3,
 *     execution_visibility 4 }, status 5);
 *   - a Workflow row (spec 4 { description 1 }, status 5
 *     { default_instance_id 1, version_hash 3 });
 *   - a workflow run row under the kind string it was written with (spec 4
 *     { workflow_instance_id 1, trigger_message 3, workflow_id 6,
 *     callback_token 7 }, status 5 { started_at 5 });
 *   - an Artifact row (spec 4 { content_type 1, display_name 2, source 3
 *     { workflow_run_id 1, agent_run_id 2, task_name 3 } });
 * and an agent run in the live schema, which may carry what a workflow
 * step left on it: the retired parent (AgentRunSpec field 17), the retired
 * task token (AgentRunStatus field 10) and the two lineage labels. Shared
 * by the modules' unit tests, the frozen-envelope test and both drivers'
 * migration tests, so every one reads the same old shape.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditStatusSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

type MetadataInit = MessageInitShape<typeof ApiResourceMetadataSchema>;

/** The lineage labels a workflow step stamped on the agent run it started. */
export const WORKFLOW_LINEAGE_LABELS = {
  "stigmer.ai/workflow-execution-id": "wex_parent",
  "stigmer.ai/workflow-task": "triage",
} as const;

/** A WorkflowInstance row as an earlier release stored it. */
export function retiredWorkflowInstanceRow(options: {
  readonly metadata: MetadataInit;
  readonly workflowId: string;
  readonly description?: string;
  readonly environmentRefs?: ReadonlyArray<
    MessageInitShape<typeof ApiResourceReferenceSchema>
  >;
  /** The retired WorkflowRunVisibility number; 0 is not written. */
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
  return envelope("WorkflowInstance", options.metadata, spec.finish(), auditStatus());
}

/** A Workflow row, a head or an archived version, as an earlier release stored it. */
export function retiredWorkflowRow(options: {
  readonly metadata: MetadataInit;
  readonly versionHash: string;
  readonly defaultInstanceId?: string;
}): Uint8Array {
  const spec = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("Nightly triage")
    .finish();
  const status = new BinaryWriter();
  if ((options.defaultInstanceId ?? "") !== "") {
    status
      .tag(1, WireType.LengthDelimited)
      .string(options.defaultInstanceId ?? "");
  }
  status.tag(3, WireType.LengthDelimited).string(options.versionHash);
  return envelope("Workflow", options.metadata, spec, status.finish());
}

/**
 * A workflow run row as an earlier release stored it, under the kind
 * string it was written with (`WorkflowExecution` before the run rename,
 * `WorkflowRun` after), naming its workflow, its instance or both, and the
 * task token of the step that waits on it when given.
 */
export function retiredWorkflowRunRow(options: {
  readonly metadata: MetadataInit;
  readonly kindString: "WorkflowExecution" | "WorkflowRun";
  readonly workflowId?: string;
  readonly instanceId?: string;
  readonly callbackToken?: Uint8Array;
}): Uint8Array {
  const spec = new BinaryWriter();
  if ((options.instanceId ?? "") !== "") {
    spec.tag(1, WireType.LengthDelimited).string(options.instanceId ?? "");
  }
  spec.tag(3, WireType.LengthDelimited).string("nightly");
  if ((options.workflowId ?? "") !== "") {
    spec.tag(6, WireType.LengthDelimited).string(options.workflowId ?? "");
  }
  if (options.callbackToken !== undefined) {
    spec.tag(7, WireType.LengthDelimited).bytes(options.callbackToken);
  }
  const status = new BinaryWriter()
    .tag(5, WireType.LengthDelimited)
    .string("2026-09-01T00:00:00Z")
    .finish();
  return envelope(options.kindString, options.metadata, spec.finish(), status);
}

/** An Artifact row as an earlier release stored it, produced by a workflow run's step or by an agent run. */
export function retiredArtifactRow(options: {
  readonly metadata: MetadataInit;
  readonly source:
    | { readonly workflowRunId: string; readonly taskName: string }
    | { readonly agentRunId: string };
}): Uint8Array {
  const source = new BinaryWriter();
  if ("workflowRunId" in options.source) {
    source
      .tag(1, WireType.LengthDelimited)
      .string(options.source.workflowRunId)
      .tag(3, WireType.LengthDelimited)
      .string(options.source.taskName);
  } else {
    source.tag(2, WireType.LengthDelimited).string(options.source.agentRunId);
  }
  const spec = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("application/json")
    .tag(2, WireType.LengthDelimited)
    .string("output.json")
    .tag(3, WireType.LengthDelimited)
    .bytes(source.finish())
    .finish();
  return envelope("Artifact", options.metadata, spec, auditStatus());
}

/**
 * An agent run of a session in the live schema, with the labels given,
 * under the kind string given (`AgentRun` unless a test seeds a store from
 * before the run rename, which wrote `AgentExecution`); with `parent`, the
 * retired AgentRunSpec field 17 naming the workflow run whose step started
 * it, and with `callbackToken`, the retired AgentRunStatus field 10; with
 * `released`, the link as every release through 3.41 wrote it instead:
 * AgentRunSpec fields 6 (`callback_token`), 8 (`parent_workflow_id`) and 11
 * (`activity_task_queue`). The run is COMPLETED unless `phase` says
 * otherwise, and has no status at all with `noStatus`; and `error` and
 * `completedAt` are stamped on its status when given. Without a parent or a
 * token, these are the bytes the current release writes, the ones a
 * migrated run must equal.
 */
export function agentRunRow(options: {
  readonly id: string;
  readonly kindString?: "AgentExecution" | "AgentRun" | "Run";
  readonly org: string;
  readonly sessionId: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly parent?: string;
  readonly callbackToken?: Uint8Array;
  readonly released?: {
    readonly callbackToken: Uint8Array;
    readonly parentWorkflowId: string;
    readonly activityTaskQueue: string;
  };
  readonly phase?: RunPhase;
  readonly error?: string;
  readonly completedAt?: string;
  readonly noStatus?: boolean;
}): Uint8Array {
  const run = create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: options.kindString ?? "AgentRun",
    metadata: {
      id: options.id,
      name: options.id,
      org: options.org,
      labels: { ...options.labels },
    },
    spec: {
      target: { case: "sessionId", value: options.sessionId },
      message: "summarise the ticket",
    },
    status: {
      phase: options.phase ?? RunPhase.RUN_COMPLETED,
      todos: { t1: { content: "read the ticket" } },
      ...(options.error !== undefined ? { error: options.error } : {}),
      ...(options.completedAt !== undefined ? { completedAt: options.completedAt } : {}),
    },
  });
  if (options.parent !== undefined && run.spec !== undefined) {
    const parent = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string(options.parent)
      .tag(2, WireType.LengthDelimited)
      .string("triage")
      .finish();
    run.spec.$unknown = [
      {
        no: 17,
        wireType: WireType.LengthDelimited,
        data: new BinaryWriter().bytes(parent).finish(),
      },
    ];
  }
  if (options.released !== undefined && run.spec !== undefined) {
    const { callbackToken, parentWorkflowId, activityTaskQueue } = options.released;
    run.spec.$unknown = [
      ...(run.spec.$unknown ?? []),
      { no: 6, wireType: WireType.LengthDelimited, data: new BinaryWriter().bytes(callbackToken).finish() },
      { no: 8, wireType: WireType.LengthDelimited, data: new BinaryWriter().string(parentWorkflowId).finish() },
      { no: 11, wireType: WireType.LengthDelimited, data: new BinaryWriter().string(activityTaskQueue).finish() },
    ];
  }
  if (options.noStatus === true) {
    run.status = undefined;
  }
  if (options.callbackToken !== undefined && run.status !== undefined) {
    run.status.$unknown = [
      {
        no: 10,
        wireType: WireType.LengthDelimited,
        data: new BinaryWriter().bytes(options.callbackToken).finish(),
      },
    ];
  }
  return toBinary(RunSchema, run);
}

/** The resource envelope every kind shares, around a spec and a status already encoded. */
function envelope(
  kindString: string,
  metadata: MetadataInit,
  spec: Uint8Array,
  status: Uint8Array,
): Uint8Array {
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string(kindString)
    .tag(3, WireType.LengthDelimited)
    .bytes(
      toBinary(
        ApiResourceMetadataSchema,
        create(ApiResourceMetadataSchema, metadata),
      ),
    )
    .tag(4, WireType.LengthDelimited)
    .bytes(spec)
    .tag(5, WireType.LengthDelimited)
    .bytes(status)
    .finish();
}

/** The status an instance or artifact row carried: its audit. */
function auditStatus(): Uint8Array {
  return toBinary(
    ApiResourceAuditStatusSchema,
    create(ApiResourceAuditStatusSchema, {
      audit: { specAudit: { event: "created" } },
    }),
  );
}
