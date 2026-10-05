/**
 * Test support: the bytes an earlier release wrote for an agent execution
 * whose settings sat in AgentExecutionSpec field 4 (ExecutionConfig), built
 * by wire number because that schema no longer exists. ExecutionConfig's
 * numbers: model_name 1, context_management 2, max_tool_rounds 3,
 * max_tool_result_chars 4, max_cost_usd 5, interaction_mode 6,
 * structured_output_schema 7, build_from_plan 8, approval_mode 9,
 * service_tier 10, thinking_mode 11. Shared by the module's unit test and
 * both drivers' migration tests, so every one reads the same old shape.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import type { JsonObject } from "@bufbuild/protobuf";
import { fromJson } from "@bufbuild/protobuf";

import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

/** The retired ExecutionConfig's values, as a test names them. */
export interface RetiredConfig {
  readonly modelName?: string;
  /** Any value: the retired context-management message, written as given. */
  readonly contextManagement?: Uint8Array;
  readonly maxToolRounds?: number;
  readonly maxToolResultChars?: number;
  readonly maxCostUsd?: number;
  readonly interactionMode?: number;
  readonly structuredOutputSchema?: JsonObject;
  readonly buildFromPlan?: boolean;
  readonly approvalMode?: number;
  readonly serviceTier?: number;
  readonly thinkingMode?: number;
}

/** One encoded ExecutionConfig. */
export function retiredConfigBytes(config: RetiredConfig): Uint8Array {
  const w = new BinaryWriter();
  if (config.modelName !== undefined) {
    w.tag(1, WireType.LengthDelimited).string(config.modelName);
  }
  if (config.contextManagement !== undefined) {
    w.tag(2, WireType.LengthDelimited).bytes(config.contextManagement);
  }
  if (config.maxToolRounds !== undefined) {
    w.tag(3, WireType.Varint).int32(config.maxToolRounds);
  }
  if (config.maxToolResultChars !== undefined) {
    w.tag(4, WireType.Varint).int32(config.maxToolResultChars);
  }
  if (config.maxCostUsd !== undefined) {
    w.tag(5, WireType.Bit64).double(config.maxCostUsd);
  }
  if (config.interactionMode !== undefined) {
    w.tag(6, WireType.Varint).int32(config.interactionMode);
  }
  if (config.structuredOutputSchema !== undefined) {
    w.tag(7, WireType.LengthDelimited).bytes(
      toBinary(StructSchema, fromJson(StructSchema, config.structuredOutputSchema)),
    );
  }
  if (config.buildFromPlan !== undefined) {
    w.tag(8, WireType.Varint).bool(config.buildFromPlan);
  }
  if (config.approvalMode !== undefined) {
    w.tag(9, WireType.Varint).int32(config.approvalMode);
  }
  if (config.serviceTier !== undefined) {
    w.tag(10, WireType.Varint).int32(config.serviceTier);
  }
  if (config.thinkingMode !== undefined) {
    w.tag(11, WireType.Varint).int32(config.thinkingMode);
  }
  return w.finish();
}

/**
 * An agent execution row as an earlier release stored it: the live
 * envelope, spec and status, with the retired field 4 appended to the spec
 * when `config` is given.
 */
export function retiredExecutionRow(options: {
  readonly metadata: MessageInitShape<typeof ApiResourceMetadataSchema>;
  readonly spec?: MessageInitShape<typeof AgentExecutionSpecSchema>;
  readonly status?: MessageInitShape<typeof AgentExecutionStatusSchema>;
  readonly config?: RetiredConfig;
}): Uint8Array {
  const spec = new BinaryWriter().raw(
    toBinary(
      AgentExecutionSpecSchema,
      create(AgentExecutionSpecSchema, options.spec ?? { message: "hello" }),
    ),
  );
  if (options.config !== undefined) {
    spec.tag(4, WireType.LengthDelimited).bytes(retiredConfigBytes(options.config));
  }
  const w = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string("AgentExecution")
    .tag(3, WireType.LengthDelimited)
    .bytes(
      toBinary(ApiResourceMetadataSchema, create(ApiResourceMetadataSchema, options.metadata)),
    )
    .tag(4, WireType.LengthDelimited)
    .bytes(spec.finish());
  if (options.status !== undefined) {
    w.tag(5, WireType.LengthDelimited).bytes(
      toBinary(AgentExecutionStatusSchema, create(AgentExecutionStatusSchema, options.status)),
    );
  }
  return w.finish();
}

/** The bytes the current release writes for the same execution. */
export function executionBytes(
  init: MessageInitShape<typeof AgentExecutionSchema>,
): Uint8Array {
  return toBinary(
    AgentExecutionSchema,
    create(AgentExecutionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      ...init,
    }),
  );
}
