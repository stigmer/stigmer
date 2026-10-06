/**
 * Pins execution-config-retired.ts: what one stored agent execution
 * becomes when its settings leave the retired execution_config.
 *
 *   - every setting moves to spec.run_config and, the same values, to
 *     status.run_config; the approval mode to status (UNATTENDED kept,
 *     anything else INTERACTIVE); the intents to the spec's top level; the
 *     context-management settings are dropped, and the result is exactly
 *     the bytes the current release writes for that turn;
 *   - a turn with no settings gains only INTERACTIVE and an empty
 *     status.run_config;
 *   - a row already in the current shape is left alone (undefined);
 *   - the last occurrence of the field wins, as proto reads a singular
 *     field;
 *   - a retired field written with another wire type than its own is
 *     skipped, never misread;
 *   - bytes that do not decode throw, and the step's error names the row.
 */
import { toBinary, create } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { AgentRunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/spec_pb";

import {
  ApprovalMode,
  InteractionMode,
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

import {
  migrateExecutionRow,
  unreadableExecutionError,
} from "../execution-config-retired.js";

import { executionBytes, retiredExecutionRow } from "./retired-execution-rows.js";

const metadata = { id: "aex_1", org: "org_1", slug: "aex-1" };

describe("migrateExecutionRow", () => {
  it("moves every setting, the approval mode and the intents, and drops context management", () => {
    const migrated = migrateExecutionRow(
      retiredExecutionRow({
        metadata,
        spec: { message: "plan this", target: { case: "sessionId", value: "ses_1" } },
        status: { agentId: "agt_1" },
        config: {
          modelName: "claude-sonnet-5",
          contextManagement: new Uint8Array([0x08, 0x01]),
          maxToolRounds: 40,
          maxToolResultChars: 50_000,
          maxCostUsd: 1.5,
          interactionMode: InteractionMode.PLAN,
          structuredOutputSchema: { type: "object" },
          buildFromPlan: true,
          approvalMode: ApprovalMode.UNATTENDED,
          serviceTier: ServiceTier.STANDARD,
          thinkingMode: ThinkingMode.ENABLED,
        },
      }),
    );
    const settings = {
      modelName: "claude-sonnet-5",
      maxToolRounds: 40,
      maxToolResultChars: 50_000,
      maxCostUsd: 1.5,
      serviceTier: ServiceTier.STANDARD,
      thinkingMode: ThinkingMode.ENABLED,
    };
    expect(migrated).toEqual(
      executionBytes({
        metadata,
        spec: {
          message: "plan this",
          target: { case: "sessionId", value: "ses_1" },
          runConfig: settings,
          interactionMode: InteractionMode.PLAN,
          buildFromPlan: true,
          structuredOutputSchema: { type: "object" },
        },
        status: {
          agentId: "agt_1",
          runConfig: settings,
          approvalMode: ApprovalMode.UNATTENDED,
        },
      }),
    );
  });

  it("reads an unspecified approval mode as interactive", () => {
    const migrated = migrateExecutionRow(
      retiredExecutionRow({ metadata, config: { modelName: "m" } }),
    );
    expect(migrated).toEqual(
      executionBytes({
        metadata,
        spec: { message: "hello", runConfig: { modelName: "m" } },
        status: { runConfig: { modelName: "m" }, approvalMode: ApprovalMode.INTERACTIVE },
      }),
    );
  });

  it("gives a turn with no settings an interactive approval mode and empty resolved settings", () => {
    expect(migrateExecutionRow(retiredExecutionRow({ metadata }))).toEqual(
      executionBytes({
        metadata,
        spec: { message: "hello" },
        status: { runConfig: {}, approvalMode: ApprovalMode.INTERACTIVE },
      }),
    );
  });

  it("leaves a row already in the current shape alone", () => {
    expect(
      migrateExecutionRow(
        executionBytes({
          metadata,
          spec: { message: "hello" },
          status: { approvalMode: ApprovalMode.INTERACTIVE },
        }),
      ),
    ).toBeUndefined();
  });

  it("reads the last occurrence of the retired field, as proto reads a singular field", () => {
    const first = retiredExecutionRow({ metadata, config: { modelName: "first", maxCostUsd: 3 } });
    const second = retiredExecutionRow({ metadata, config: { modelName: "second" } });
    // Two encodings of the whole row concatenated merge field by field.
    const merged = new Uint8Array([...first, ...second]);
    const migrated = migrateExecutionRow(merged);
    expect(migrated).toBeDefined();
    expect(migrated).toEqual(
      migrateExecutionRow(
        retiredExecutionRow({ metadata, config: { modelName: "second", maxCostUsd: 3 } }),
      ),
    );
  });

  it("throws on bytes that do not decode, and the step's error names the row", () => {
    expect(() => migrateExecutionRow(new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
    expect(unreadableExecutionError("aex_bad", new Error("boom")).message).toContain(
      "agent_execution 'aex_bad'",
    );
  });

  it("skips a retired field written with another wire type than its own", () => {
    // Every field at a wire type its schema never wrote: a string as a
    // varint, a varint as bytes, a double as a varint, a bool as bytes, a
    // Struct as a varint.
    const config = new BinaryWriter()
      .tag(1, WireType.Varint).int32(7)
      .tag(3, WireType.LengthDelimited).string("x")
      .tag(5, WireType.Varint).int32(9)
      .tag(8, WireType.LengthDelimited).string("y")
      .tag(7, WireType.Varint).int32(1)
      .finish();
    const spec = new BinaryWriter()
      .raw(toBinary(AgentRunSpecSchema, create(AgentRunSpecSchema, { message: "hello" })))
      .tag(4, WireType.LengthDelimited)
      .bytes(config)
      .finish();
    const row = new BinaryWriter()
      .tag(2, WireType.LengthDelimited)
      .string("AgentExecution")
      .tag(4, WireType.LengthDelimited)
      .bytes(spec)
      .finish();
    expect(migrateExecutionRow(row)).toEqual(
      executionBytes({
        apiVersion: "",
        spec: { message: "hello", runConfig: {} },
        status: { runConfig: {}, approvalMode: ApprovalMode.INTERACTIVE },
      }),
    );
  });
});
