/**
 * The one data migration both store drivers run when a turn's settings
 * leave ExecutionConfig: every stored agent execution is rewritten into
 * the shape the current release reads. The drivers own the SQL (the pages,
 * the writes, the transaction); this module owns what one row becomes.
 *
 * A turn stored before the release holds its settings in
 * AgentExecutionSpec field 4 (execution_config), which the contract now
 * reserves, so the current schema decodes it as an unknown field
 * (protobuf-es keeps unknown fields through `fromBinary`). It is read by
 * wire number, never through a schema that no longer exists
 * (agent-instance-retired.ts, the precedent), and dropped. What the row
 * becomes:
 *
 *   - the settings (model, tier, thinking, tool rounds, result size, cost)
 *     go to spec.run_config, what the turn asked for, and to
 *     status.run_config, what it ran with: every lane had already merged
 *     its layers into the request before the release, so the request is
 *     what ran;
 *   - the approval mode goes to status.approval_mode, UNSPECIFIED read as
 *     INTERACTIVE (the enum's own default);
 *   - the per-message intents (interaction mode, build-from-plan, the
 *     structured-output schema) go to the top level of the spec, so a plan
 *     turn keeps its badge and a workflow step its schema;
 *   - the retired context-management settings, which nothing read, are
 *     dropped.
 *
 * A turn with no field 4 gains only its approval mode (INTERACTIVE) and an
 * empty status.run_config, so every turn reads one shape: the settings it
 * ran with were the engine's defaults. A row already in the new shape (a
 * status approval mode set) is left byte for byte as it is.
 *
 * Only the live rows are rewritten. Their `updated_at` is left alone: the
 * execution list keys are read from fields the step does not touch, so the
 * list index stays proven, and the stamp keeps meaning the turn's last
 * activity. Audit snapshots keep the bytes they were archived with.
 *
 * An undecodable row fails the step, the rule the other data migrations
 * keep: the driver's transaction rolls back and the boot stops on the row
 * it names.
 */
import { clone, create, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";
import { StructSchema } from "@bufbuild/protobuf/wkt";

import {
  AgentRunSchema,
  AgentRunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ApprovalMode } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { RunConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/invocation_pb";

/** The `kind` column value of the rows the step rewrites. */
export const EXECUTION_KIND = "agent_execution";

/**
 * How many execution rows the step decodes per page: fewer than the other
 * data migrations' 500, because a turn's row carries its whole transcript.
 */
export const EXECUTION_CONFIG_PAGE_SIZE = 100;

/** The retired AgentExecutionSpec field that held the ExecutionConfig. */
const SPEC_EXECUTION_CONFIG_FIELD = 4;

/** The retired ExecutionConfig's field numbers, as its rows were written. */
const RETIRED = {
  modelName: 1,
  maxToolRounds: 3,
  maxToolResultChars: 4,
  maxCostUsd: 5,
  interactionMode: 6,
  structuredOutputSchema: 7,
  buildFromPlan: 8,
  approvalMode: 9,
  serviceTier: 10,
  thinkingMode: 11,
} as const;

/** What the step reads out of one retired ExecutionConfig. */
interface RetiredExecutionConfig {
  modelName: string;
  maxToolRounds: number;
  maxToolResultChars: number;
  maxCostUsd: number;
  interactionMode: number;
  structuredOutputSchema: Uint8Array | undefined;
  buildFromPlan: boolean;
  approvalMode: number;
  serviceTier: number;
  thinkingMode: number;
}

/**
 * The migrated bytes of one execution row, or undefined when it is already
 * in the current shape (the driver then leaves its bytes as they are).
 * Throws when the bytes do not decode.
 */
export function migrateExecutionRow(data: Uint8Array): Uint8Array | undefined {
  const execution = fromBinary(AgentRunSchema, data);
  const unknown = execution.spec?.$unknown ?? [];
  const held = unknown.filter(
    (f) =>
      f.no === SPEC_EXECUTION_CONFIG_FIELD &&
      f.wireType === WireType.LengthDelimited,
  );
  if (
    held.length === 0 &&
    (execution.status?.approvalMode ?? ApprovalMode.UNSPECIFIED) !==
      ApprovalMode.UNSPECIFIED
  ) {
    return undefined;
  }

  // Proto's last-one-wins for a singular message field: merge in order.
  const retired = emptyRetired();
  for (const field of held) {
    readRetired(new BinaryReader(field.data).bytes(), retired);
  }

  const settings = create(RunConfigSchema, {
    modelName: retired.modelName,
    maxCostUsd: retired.maxCostUsd,
    maxToolRounds: retired.maxToolRounds,
    serviceTier: retired.serviceTier,
    thinkingMode: retired.thinkingMode,
    maxToolResultChars: retired.maxToolResultChars,
  });
  const spec = execution.spec;
  if (spec !== undefined) {
    spec.$unknown = unknown.filter((f) => f.no !== SPEC_EXECUTION_CONFIG_FIELD);
    if (spec.$unknown.length === 0) {
      delete spec.$unknown;
    }
    if (held.length > 0) {
      spec.runConfig = settings;
      spec.interactionMode = retired.interactionMode;
      spec.buildFromPlan = retired.buildFromPlan;
      if (retired.structuredOutputSchema !== undefined) {
        spec.structuredOutputSchema = toJson(
          StructSchema,
          fromBinary(StructSchema, retired.structuredOutputSchema),
        ) as JsonObject;
      }
    }
  }
  const status = (execution.status ??= create(AgentRunStatusSchema));
  status.runConfig = clone(RunConfigSchema, settings);
  status.approvalMode =
    retired.approvalMode === ApprovalMode.UNATTENDED
      ? ApprovalMode.UNATTENDED
      : ApprovalMode.INTERACTIVE;
  return toBinary(AgentRunSchema, execution);
}

/** The step's failure for a row it cannot read (the module header). */
export function unreadableExecutionError(id: string, error: unknown): Error {
  return new Error(
    `${EXECUTION_KIND} '${id}' cannot be read to move its settings out of execution_config: ${String(error)}`,
    { cause: error },
  );
}

function emptyRetired(): RetiredExecutionConfig {
  return {
    modelName: "",
    maxToolRounds: 0,
    maxToolResultChars: 0,
    maxCostUsd: 0,
    interactionMode: 0,
    structuredOutputSchema: undefined,
    buildFromPlan: false,
    approvalMode: 0,
    serviceTier: 0,
    thinkingMode: 0,
  };
}

/** Reads one encoded ExecutionConfig into `into`, last value winning per field. */
function readRetired(message: Uint8Array, into: RetiredExecutionConfig): void {
  const reader = new BinaryReader(message);
  while (reader.pos < reader.len) {
    const [no, wireType] = reader.tag();
    switch (no) {
      case RETIRED.modelName:
        if (wireType === WireType.LengthDelimited) {
          into.modelName = reader.string();
          continue;
        }
        break;
      case RETIRED.maxToolRounds:
      case RETIRED.maxToolResultChars:
      case RETIRED.interactionMode:
      case RETIRED.approvalMode:
      case RETIRED.serviceTier:
      case RETIRED.thinkingMode:
        if (wireType === WireType.Varint) {
          setVarint(into, no, reader.int32());
          continue;
        }
        break;
      case RETIRED.maxCostUsd:
        if (wireType === WireType.Bit64) {
          into.maxCostUsd = reader.double();
          continue;
        }
        break;
      case RETIRED.buildFromPlan:
        if (wireType === WireType.Varint) {
          into.buildFromPlan = reader.bool();
          continue;
        }
        break;
      case RETIRED.structuredOutputSchema:
        if (wireType === WireType.LengthDelimited) {
          into.structuredOutputSchema = reader.bytes();
          continue;
        }
        break;
      default:
        break;
    }
    reader.skip(wireType, no);
  }
}

function setVarint(into: RetiredExecutionConfig, no: number, value: number): void {
  switch (no) {
    case RETIRED.maxToolRounds:
      into.maxToolRounds = value;
      return;
    case RETIRED.maxToolResultChars:
      into.maxToolResultChars = value;
      return;
    case RETIRED.interactionMode:
      into.interactionMode = value;
      return;
    case RETIRED.approvalMode:
      into.approvalMode = value;
      return;
    case RETIRED.serviceTier:
      into.serviceTier = value;
      return;
    default:
      into.thinkingMode = value;
  }
}
