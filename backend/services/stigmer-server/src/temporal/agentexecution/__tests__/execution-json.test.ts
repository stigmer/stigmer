/**
 * The run status JSON that crosses Temporal is decoded strictly, with one
 * tolerance: an activity's input is recorded when it is scheduled, so a
 * status write in flight across a deploy is decoded by the next release.
 * Pins that:
 *
 * - a field the message reserves (a release removed it while a status
 *   write recorded before the deploy still names it) is dropped, under its
 *   JSON or its proto name, in a held message too (once, in a list, in a
 *   map), while a status write's other unknown fields
 *   are refused; a message built here reserves the names, so the rule
 *   stays proven while the contract reserves none;
 * - an enum value name the contract does not have is refused, never read
 *   as another value (`EXECUTION_COMPLETED` is not `RUN_COMPLETED`), and a
 *   value given by number is kept;
 * - the runner result's phase is read by its name, and a name the enum
 *   does not have reads as UNSPECIFIED.
 */
import { describe, expect, it } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { create, createFileRegistry, type DescMessage, type JsonObject } from "@bufbuild/protobuf";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import { decodeRunStatusJson } from "../execution-json.js";
import { getPhaseFromResult } from "../runner-result.js";

/**
 * A status message that reserves two field names, as a release that removes
 * a field leaves its message, and holds a message that reserves one, once,
 * in a list and in a map.
 */
const RESERVING_STATUS: DescMessage = createFileRegistry(
  create(FileDescriptorProtoSchema, {
    name: "reserving_status_fixture.proto",
    package: "executionjson.fixture.v1",
    syntax: "proto3",
    messageType: [
      {
        name: "Status",
        field: [
          {
            name: "phase",
            number: 1,
            type: FieldDescriptorProto_Type.STRING,
            label: FieldDescriptorProto_Label.OPTIONAL,
            jsonName: "phase",
          },
          ...(
            [
              ["item", 5, FieldDescriptorProto_Label.OPTIONAL, ".executionjson.fixture.v1.Item"],
              ["items", 6, FieldDescriptorProto_Label.REPEATED, ".executionjson.fixture.v1.Item"],
              ["by_name", 7, FieldDescriptorProto_Label.REPEATED, ".executionjson.fixture.v1.Status.ByNameEntry"],
            ] as const
          ).map(([name, number, label, typeName]) => ({
            name,
            number,
            label,
            typeName,
            type: FieldDescriptorProto_Type.MESSAGE,
            jsonName: name === "by_name" ? "byName" : name,
          })),
        ],
        nestedType: [
          {
            name: "ByNameEntry",
            options: { mapEntry: true },
            field: [
              { name: "key", number: 1, type: FieldDescriptorProto_Type.STRING, label: FieldDescriptorProto_Label.OPTIONAL, jsonName: "key" },
              {
                name: "value",
                number: 2,
                type: FieldDescriptorProto_Type.MESSAGE,
                typeName: ".executionjson.fixture.v1.Item",
                label: FieldDescriptorProto_Label.OPTIONAL,
                jsonName: "value",
              },
            ],
          },
        ],
        reservedRange: [{ start: 2, end: 4 }],
        reservedName: ["transcript_lines", "supersedes_run_id"],
      },
      {
        name: "Item",
        field: [
          { name: "name", number: 1, type: FieldDescriptorProto_Type.STRING, label: FieldDescriptorProto_Label.OPTIONAL, jsonName: "name" },
        ],
        reservedRange: [{ start: 2, end: 3 }],
        reservedName: ["old_note"],
      },
    ],
  }),
  () => undefined,
).getMessage("executionjson.fixture.v1.Status")!;

describe("the run JSON recorded before a release", () => {
  it("decodes a status write that names a field the message reserves, the field dropped under its JSON or its proto name", () => {
    const recorded: JsonObject[] = [
      { phase: "paused", transcriptLines: [{ content: "Paused by user" }] },
      { phase: "paused", transcript_lines: [] },
      { phase: "paused", supersedesRunId: "run_a" },
    ];
    for (const json of recorded) {
      expect(decodeRunStatusJson(RESERVING_STATUS, json), JSON.stringify(json)).toMatchObject({ phase: "paused" });
    }
  });

  it("drops a reserved name in a message the status holds, once, in a list and in a map", () => {
    const decoded = decodeRunStatusJson(RESERVING_STATUS, {
      phase: "paused",
      item: { name: "a", oldNote: "x" },
      items: [{ name: "b", old_note: "y" }],
      byName: { c: { name: "c", oldNote: "z" } },
    });
    expect(decoded).toMatchObject({ phase: "paused", item: { name: "a" }, items: [{ name: "b" }] });
    expect((decoded as unknown as { byName: Record<string, { name: string }> }).byName.c?.name).toBe("c");
  });

  it("refuses any other field a status write does not know", () => {
    expect(() => decodeRunStatusJson(RunStatusSchema, { phase: "RUN_PAUSED", removedField: true })).toThrow();
  });

  it("refuses an enum value name the contract does not have, never reading it as another", () => {
    expect(() => decodeRunStatusJson(RunStatusSchema, { phase: "EXECUTION_COMPLETED" })).toThrow();
    expect(decodeRunStatusJson(RunStatusSchema, { phase: "RUN_COMPLETED" }).phase).toBe(RunPhase.RUN_COMPLETED);
  });

  it("refuses a value that is not the shape its message declares", () => {
    expect(() => decodeRunStatusJson(RunStatusSchema, "not an object")).toThrow();
  });

  it("keeps an enum value given by number", () => {
    expect(decodeRunStatusJson(RunStatusSchema, { phase: 3 }).phase).toBe(RunPhase.RUN_COMPLETED);
  });
});

describe("getPhaseFromResult", () => {
  it("reads the phase by its name, and a name the enum does not have as UNSPECIFIED", () => {
    expect(getPhaseFromResult({ phase: "RUN_COMPLETED" })).toBe(RunPhase.RUN_COMPLETED);
    expect(getPhaseFromResult({ phase: "EXECUTION_WAITING_FOR_APPROVAL" })).toBe(
      RunPhase.RUN_PHASE_UNSPECIFIED,
    );
  });

  it("reads a numeric phase as is, and an absent or unreadable one as UNSPECIFIED", () => {
    expect(getPhaseFromResult({ phase: RunPhase.RUN_FAILED })).toBe(RunPhase.RUN_FAILED);
    expect(getPhaseFromResult(null)).toBe(RunPhase.RUN_PHASE_UNSPECIFIED);
    expect(getPhaseFromResult(undefined)).toBe(RunPhase.RUN_PHASE_UNSPECIFIED);
    expect(getPhaseFromResult({ phase: true })).toBe(RunPhase.RUN_PHASE_UNSPECIFIED);
  });
});
