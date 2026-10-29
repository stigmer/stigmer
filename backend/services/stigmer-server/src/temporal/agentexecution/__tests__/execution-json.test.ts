/**
 * The run JSON that crosses Temporal is decoded from what an older server
 * or runner wrote: a local activity's result is replayed from history, and
 * an activity's input or a runner's result was recorded before the deploy.
 * Pins that:
 *
 * - names retired by the rename of executions to runs (field JSON names,
 *   enum value names, the kind string) read as their current names, fed
 *   the JSON the replay histories record, while a free-form string that
 *   happens to spell a retired name is left as written;
 * - names retired by the rename of the agent run to a run (the kind string
 *   `AgentRun`, the kind value `agent_run`) read as their current names in
 *   one hop;
 * - a field the message reserves (a release removed it while a status
 *   write recorded before the deploy still names it) is dropped, under its
 *   current or its retired spelling, while a status write's other unknown
 *   fields are refused; a message built here reserves the names, so the
 *   rule stays proven while the contract reserves none;
 * - a field set under both its retired and its current name is refused,
 *   not decided by its place in the payload;
 * - the runner result's phase lookup reads a retired phase name;
 * - the retired-names tables hold exactly the run-named fields (reserved
 *   ones included) and enum values of the messages that cross Temporal,
 *   each from its name before the rename, so they cannot drift from the
 *   contract.
 */
import { describe, expect, it } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import { create, createFileRegistry, type DescMessage } from "@bufbuild/protobuf";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import {
  RETIRED_ENUM_VALUE_NAMES,
  RETIRED_FIELD_NAMES,
  decodeRunStatusJson,
  renameRetiredRunJson,
} from "../execution-json.js";
import { getPhaseFromResult } from "../runner-result.js";

/**
 * A status message that reserves two field names, as a release that removes
 * a field leaves its message: `transcript_lines`, and `supersedes_run_id`,
 * whose retired spelling (`supersedes_execution_id`) the tables still map.
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
        ],
        reservedRange: [{ start: 2, end: 4 }],
        reservedName: ["transcript_lines", "supersedes_run_id"],
      },
    ],
  }),
  () => undefined,
).getMessage("executionjson.fixture.v1.Status")!;

describe("the run JSON recorded before a release", () => {
  it("renames what a replay history records, written before the run rename", () => {
    // hitl-approval.json's LoadAgentExecution marker result, with the kind
    // string and a renamed field an older server also wrote.
    expect(
      renameRetiredRunJson(RunSchema, {
        kind: "AgentExecution",
        metadata: { id: "exec-replay" },
        spec: { supersedesExecutionId: "aex_prev" },
        status: { phase: "EXECUTION_WAITING_FOR_APPROVAL" },
      }),
    ).toEqual({
      kind: "Run",
      metadata: { id: "exec-replay" },
      spec: { supersedesRunId: "aex_prev" },
      status: { phase: "RUN_WAITING_FOR_APPROVAL" },
    });
  });

  it("renames what was written under the agent run's names, the kind and the kind value each in one hop", () => {
    expect(
      renameRetiredRunJson(RunSchema, {
        kind: "AgentRun",
        spec: { sessionSpec: { agentRef: { kind: "agent_run", slug: "triage" } } },
      }),
    ).toEqual({ kind: "Run", spec: { sessionSpec: { agentRef: { kind: "run", slug: "triage" } } } });
    expect(
      renameRetiredRunJson(RunSchema, { spec: { sessionSpec: { agentRef: { kind: "agent_execution" } } } }),
    ).toEqual({ spec: { sessionSpec: { agentRef: { kind: "run" } } } });
  });

  it("decodes a status write that names a field the message reserves, the field dropped under its JSON or its proto name", () => {
    for (const json of [
      { phase: "paused", transcriptLines: [{ content: "Paused by user" }] },
      { phase: "paused", transcript_lines: [] },
    ]) {
      expect(decodeRunStatusJson(RESERVING_STATUS, json), JSON.stringify(json)).toMatchObject({ phase: "paused" });
    }
  });

  it("drops a reserved field under its retired spelling too", () => {
    expect(
      renameRetiredRunJson(RESERVING_STATUS, { phase: "done", supersedesExecutionId: "run_a" }),
    ).toEqual({ phase: "done" });
  });

  it("refuses any other field a status write does not know", () => {
    expect(() => decodeRunStatusJson(RunStatusSchema, { phase: "RUN_PAUSED", removedField: true })).toThrow();
  });

  it("walks map fields: a scalar value is kept as written", () => {
    expect(renameRetiredRunJson(RunSchema, { metadata: { id: "aex_3", labels: { phase: "EXECUTION_COMPLETED" } } })).toEqual({
      metadata: { id: "aex_3", labels: { phase: "EXECUTION_COMPLETED" } },
    });
  });

  it("leaves a value that is not the shape its field declares to the decoder", () => {
    expect(renameRetiredRunJson(RunSchema, "not an object")).toBe("not an object");
    expect(renameRetiredRunJson(RunSchema, { status: ["not", "an", "object"] })).toEqual({
      status: ["not", "an", "object"],
    });
    expect(renameRetiredRunJson(RunSchema, { metadata: { labels: ["not", "a", "map"] } })).toEqual({
      metadata: { labels: ["not", "a", "map"] },
    });
  });

  it("keeps an enum value given by number, and a retired name that is not this enum's", () => {
    expect(decodeRunStatusJson(RunStatusSchema, { phase: 3 }).phase).toBe(RunPhase.RUN_COMPLETED);
    expect(renameRetiredRunJson(RunSchema, { status: { phase: "agent_execution" } })).toEqual({
      status: { phase: "agent_execution" },
    });
  });

  it("rewrites a kind string only where the contract declares one: a run's own kind, not an enum named kind", () => {
    expect(
      renameRetiredRunJson(RunSchema, {
        kind: "AgentExecution",
        status: { loadedVersions: { skills: [{ kind: "AgentExecution" }] } },
      }),
    ).toEqual({ kind: "Run", status: { loadedVersions: { skills: [{ kind: "AgentExecution" }] } } });
  });

  it("refuses a field set under its retired and its current name, whichever comes first", () => {
    for (const spec of [
      { supersedesExecutionId: "aex_a", supersedesRunId: "aex_b" },
      { supersedesRunId: "aex_b", supersedesExecutionId: "aex_a" },
    ]) {
      expect(() => renameRetiredRunJson(RunSchema, { spec })).toThrow(
        /ai\.stigmer\.agentic\.run\.v1\.RunSpec sets the field supersedesRunId twice/,
      );
    }
  });
});

describe("getPhaseFromResult", () => {
  it("reads the phase a runner result recorded before the run rename", () => {
    // The ExecuteAgent result hitl-approval.json records.
    expect(getPhaseFromResult({ phase: "EXECUTION_WAITING_FOR_APPROVAL" })).toBe(
      RunPhase.RUN_WAITING_FOR_APPROVAL,
    );
    expect(getPhaseFromResult({ phase: "RUN_COMPLETED" })).toBe(RunPhase.RUN_COMPLETED);
    expect(getPhaseFromResult({ phase: "EXECUTION_EXPLODED" })).toBe(
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

/** A name before the rename: its `run` words said `execution`. */
function retiredSpelling(name: string): string {
  return name
    .replace(/(^|_)runs($|_)/g, "$1executions$2")
    .replace(/(^|_)run($|_)/g, "$1execution$2")
    .replace(/(^|_)RUN(_|$)/g, "$1EXECUTION$2");
}

/** lowerCamelCase of a proto field name, as its JSON name spells it. */
function jsonSpelling(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

describe("the retired-names tables", () => {
  // `run_config` carried that name before the rename.
  const NAMED_RUN_BEFORE = new Set(["run_config"]);
  // The run kind's enum value, renamed twice: `agent_execution`, then
  // `agent_run`, both read straight as `run`.
  const KIND_VALUE_BEFORE: ReadonlyArray<readonly [string, string]> = [
    ["agent_execution", "run"],
    ["agent_run", "run"],
  ];
  // Enums born after the rename, under their run names: no stored or
  // in-flight payload ever spelled them another way.
  const BORN_AS_RUN = new Set([
    "ai.stigmer.agentic.run.v1.RunValueDeclarerKind",
    "ai.stigmer.agentic.run.v1.RunValueOrigin",
  ]);

  function crossingNames(): { fields: Map<string, string>; values: Map<string, string> } {
    const fields = new Map<string, string>();
    const values = new Map<string, string>();
    const seen = new Set<string>();
    const visit = (desc: DescMessage): void => {
      if (seen.has(desc.typeName) || desc.typeName.startsWith("google.protobuf.")) return;
      seen.add(desc.typeName);
      // A name the message reserved since still crosses in recorded JSON.
      for (const name of desc.proto.reservedName) {
        if (/(^|_)runs?($|_)/.test(name) && !NAMED_RUN_BEFORE.has(name)) {
          const retired = retiredSpelling(name);
          fields.set(retired, name);
          fields.set(jsonSpelling(retired), jsonSpelling(name));
        }
      }
      for (const field of desc.fields) {
        if (/(^|_)runs?($|_)/.test(field.name) && !NAMED_RUN_BEFORE.has(field.name)) {
          const retired = retiredSpelling(field.name);
          fields.set(retired, field.name);
          fields.set(jsonSpelling(retired), field.jsonName);
        }
        const enumValues = field.enum !== undefined && BORN_AS_RUN.has(field.enum.typeName) ? [] : (field.enum?.values ?? []);
        for (const value of enumValues) {
          if (field.enum?.typeName.endsWith(".ApiResourceKind")) {
            // Of the kinds, only `run` was renamed; another kind named for
            // runs (`eval_run`) was born with its name.
            if (value.name === "run") for (const [before, now] of KIND_VALUE_BEFORE) values.set(before, now);
          } else if (/(^|_)(RUN|runs?)(_|$)/.test(value.name)) {
            values.set(retiredSpelling(value.name), value.name);
          }
        }
        if (field.message !== undefined) visit(field.message);
      }
    };
    [RunSchema, RunStatusSchema].forEach(visit);
    return { fields, values };
  }

  it("map every run-named field and enum value that crosses Temporal from its name before the rename, and nothing else", () => {
    const { fields, values } = crossingNames();
    expect(new Map([...RETIRED_FIELD_NAMES].sort())).toEqual(new Map([...fields].sort()));
    expect(new Map([...RETIRED_ENUM_VALUE_NAMES].sort())).toEqual(new Map([...values].sort()));
  });
});
